/**
 * MCP server exposing ITA Matrix fare search.
 *
 * Everything is built around slices: a trip is a list of legs, so one-way,
 * round-trip and arbitrary multi-city/open-jaw itineraries all use the same
 * tool. Per-leg routing codes are what make genuinely complex routes
 * expressible.
 */

import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { MatrixClient, buildSlice, MatrixError } from "./matrix-client.js";
import {
  normalizeSolution,
  sortSolutions,
  dedupe,
  renderSolutions,
  renderDetail,
  parsePrice,
  hm,
} from "./format.js";
import { ROUTING_REFERENCE } from "./routing-reference.js";

const client = new MatrixClient({
  timeoutMs: Number(process.env.ITA_MATRIX_TIMEOUT_MS) || 150000,
});

/**
 * Searches are expensive (20–60s), and detail lookups need the session and
 * solutionSet from the originating search. Hold recent searches so
 * get_itinerary_details is a cheap follow-up instead of a full re-run.
 *
 * Deliberately module-scoped, NOT per-server. An HTTP MCP session is far
 * shorter-lived than the user's train of thought: it is swept after 30 minutes
 * idle, and any reconnect (new conversation, dropped stream, client restart)
 * opens a fresh one. When the cache lived inside createServer(), every one of
 * those events silently emptied it, and get_itinerary_details answered
 * "Unknown Search ID" for an ID the model had just been handed. Scoping the
 * cache to the process decouples it from session churn.
 *
 * Because IDs now outlive the session that minted them, they carry a random
 * suffix: unguessable, so one client still cannot read another's results.
 */
const searches = new Map();
const MAX_CACHED = 50;
const SEARCH_TTL_MS = 6 * 60 * 60 * 1000;
let searchSeq = 0;

function pruneSearches() {
  const cutoff = Date.now() - SEARCH_TTL_MS;
  for (const [id, e] of searches) {
    if (e.createdAt < cutoff) searches.delete(id);
  }
  // Map iterates in insertion order, so this drops the oldest first.
  while (searches.size > MAX_CACHED) searches.delete(searches.keys().next().value);
}

function remember(entry) {
  const id = `s${++searchSeq}-${randomBytes(3).toString("hex")}`;
  searches.set(id, { ...entry, createdAt: Date.now() });
  pruneSearches();
  return id;
}

/** Flight numbers flown, in order — stable across re-runs of the same search. */
const signature = (sol) => sol.slices.map((s) => s.flights.join(">")).join("|");

/**
 * Build a fully-wired MCP server. Called once per stdio process, and once per
 * HTTP session.
 */
export function createServer() {

const text = (t) => ({ content: [{ type: "text", text: t }] });
const fail = (t) => ({ content: [{ type: "text", text: t }], isError: true });

function handle(err) {
  if (err instanceof MatrixError) return fail(err.message);
  return fail(`Unexpected error: ${err?.message || String(err)}`);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const sliceSchema = z.object({
  origin: z
    .string()
    .describe(
      'Origin. IATA airport ("JFK"), metro city code covering all its ' +
        'airports ("NYC", "LON"), or a comma-separated set ("JFK,EWR,LGA").'
    ),
  destination: z.string().describe("Destination, same formats as origin."),
  date: z.string().describe("Departure date, YYYY-MM-DD."),
  routing: z
    .string()
    .optional()
    .describe(
      "ITA routing-language code for THIS leg — the main tool for complex " +
        'routes. Examples: "UA+" (only United), "(AA|BA)+" (either), ' +
        '"AA+ LHR AA+" (American, connecting at Heathrow), "DL DL DL" ' +
        '(exactly 3 Delta flights), "X:LAX" (avoid LAX). ' +
        "Call routing_language_reference for the full syntax."
    ),
  extraCodes: z
    .string()
    .optional()
    .describe(
      'Matrix extension/command codes for this leg, e.g. "f bc=J|C" to force ' +
        'business fare buckets, "f bc=Y" for full-fare economy.'
    ),
  departAfter: z.string().optional().describe('Earliest departure, "HH:MM".'),
  departBefore: z.string().optional().describe('Latest departure, "HH:MM".'),
  flexDays: z
    .number()
    .int()
    .min(0)
    .max(7)
    .optional()
    .describe("Also search this many days either side of the date."),
});

const paxSchema = {
  adults: z.number().int().min(0).max(9).optional(),
  seniors: z.number().int().min(0).max(9).optional(),
  youths: z.number().int().min(0).max(9).optional(),
  children: z.number().int().min(0).max(9).optional(),
  infantsInSeat: z.number().int().min(0).max(9).optional(),
  infantsInLap: z.number().int().min(0).max(9).optional(),
};

const commonSchema = {
  cabin: z
    .enum(["COACH", "PREMIUM_COACH", "BUSINESS", "FIRST"])
    .optional()
    .describe("Minimum cabin. Default COACH."),
  maxStops: z
    .number()
    .int()
    .min(0)
    .max(4)
    .optional()
    .describe(
      "Stops allowed RELATIVE TO the minimum possible for the route (Matrix " +
        "semantics), not absolute. 0 = only the shortest-hop routings. Default 1."
    ),
  currency: z.string().optional().describe('ISO 4217, e.g. "USD", "EUR".'),
  salesCity: z
    .string()
    .optional()
    .describe(
      "IATA city code for point of sale. Changes which fares are filed and " +
        "offered — useful for finding cheaper origin-country pricing."
    ),
  ...paxSchema,
};

function paxFrom(a) {
  const p = { adults: a.adults ?? 1 };
  for (const k of ["seniors", "youths", "children", "infantsInSeat", "infantsInLap"]) {
    if (a[k]) p[k] = a[k];
  }
  return p;
}

const server = new McpServer(
  { name: "ita-matrix", version: "1.0.0" },
  {
    instructions:
      "Searches ITA Matrix (Google's fare engine behind many airline sites) " +
      "for real, bookable airfares. Its edge over ordinary flight search is " +
      "arbitrary multi-city routing plus ITA's routing language, which can " +
      "force specific carriers, connection points, alliances, or flight " +
      "counts per leg. Searches take 20-60s; complex ones longer. " +
      "Results are priced but not bookable here — take the flight numbers to " +
      "the airline or an OTA to ticket them.",
  }
);

server.registerTool(
  "search_flights",
  {
    title: "Search flights (multi-city capable)",
    description:
      "Search ITA Matrix for itineraries. A trip is a list of legs (slices):\n" +
      "  • 1 slice  = one-way\n" +
      "  • 2 slices = round-trip (second slice reverses the first)\n" +
      "  • 3+       = multi-city / open-jaw — legs need not connect\n" +
      "Each leg takes its own routing code, so you can pin a carrier, force a " +
      "connection city, or require a specific number of flights per leg. " +
      "Expect 20-60s. Returns ranked itineraries and a Search ID for " +
      "get_itinerary_details.",
    inputSchema: {
      slices: z
        .array(sliceSchema)
        .min(1)
        .max(6)
        .describe(
          "The legs, in travel order. For a round-trip, add a second slice " +
            "with origin/destination swapped."
        ),
      sort: z
        .enum(["price", "duration", "departure", "arrival", "stops"])
        .optional()
        .describe("Client-side sort. Default price."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(40)
        .optional()
        .describe("How many itineraries to return. Default 10."),
      ...commonSchema,
    },
  },
  async (a) => {
    try {
      for (const s of a.slices) {
        if (!DATE_RE.test(s.date)) {
          return fail(`Invalid date "${s.date}" — dates must be YYYY-MM-DD.`);
        }
      }
      const limit = a.limit ?? 10;
      const sort = a.sort ?? "price";

      const slices = a.slices.map((s) =>
        buildSlice({
          origin: s.origin,
          destination: s.destination,
          date: s.date,
          routing: s.routing,
          commandLine: s.extraCodes,
          departAfter: s.departAfter,
          departBefore: s.departBefore,
          flexMinus: s.flexDays ?? 0,
          flexPlus: s.flexDays ?? 0,
        })
      );
      const pax = paxFrom(a);

      const pageSize = Math.max(limit * 3, 30);
      const raw = await client.search({
        slices,
        pax,
        cabin: a.cabin,
        maxStops: a.maxStops,
        currency: a.currency,
        salesCity: a.salesCity,
        pageSize,
      });

      const all = (raw.solutionList?.solutions || []).map(normalizeSolution);
      if (!all.length) {
        return text(
          "No itineraries found. Common causes: routing code too strict, " +
            "maxStops=0 on a route needing a connection, or no availability " +
            "in the requested cabin."
        );
      }

      const picked = sortSolutions(dedupe(all), sort).slice(0, limit);
      const id = remember({
        solutionSet: raw.solutionSet,
        session: raw.session,
        slices,
        pax,
        cabin: a.cabin,
        maxStops: a.maxStops,
        currency: a.currency,
        salesCity: a.salesCity,
        pageSize,
        ranked: picked,
      });

      return text(
        renderSolutions(picked, {
          searchId: id,
          totalCount: raw.solutionCount,
          sort,
        })
      );
    } catch (e) {
      return handle(e);
    }
  }
);

server.registerTool(
  "get_itinerary_details",
  {
    title: "Expand one itinerary",
    description:
      "Show per-segment detail for one itinerary from a previous search: " +
      "operating flight numbers, booking class (RBD), fare basis codes, and " +
      "aircraft type. Reuses the earlier search session, so it is normally " +
      "fast; if that session has expired upstream it silently re-runs the " +
      "original search, which takes as long as the search did.",
    inputSchema: {
      searchId: z
        .string()
        .describe('Search ID exactly as returned by search_flights, e.g. "s1-a7f2c9".'),
      rank: z
        .number()
        .int()
        .min(1)
        .describe("Which itinerary — the #N shown in the search results."),
    },
  },
  async ({ searchId, rank }) => {
    try {
      pruneSearches();
      const entry = searches.get(searchId);
      if (!entry) {
        return fail(
          `Unknown Search ID "${searchId}" — it has expired or was never issued ` +
            `(results are kept for 6 hours). Known IDs: ` +
            `${[...searches.keys()].join(", ") || "none"}. ` +
            `Re-run search_flights and use the ID it returns.`
        );
      }
      const target = entry.ranked[rank - 1];
      if (!target) {
        return fail(`Rank ${rank} out of range — that search returned ${entry.ranked.length}.`);
      }

      const detailArgs = {
        slices: entry.slices,
        pax: entry.pax,
        cabin: entry.cabin,
        maxStops: entry.maxStops,
        currency: entry.currency,
        salesCity: entry.salesCity,
      };

      let raw;
      try {
        raw = await client.detail({
          ...detailArgs,
          solutionSet: entry.solutionSet,
          session: entry.session,
          solutionId: target.id,
        });
      } catch (e) {
        if (!(e instanceof MatrixError)) throw e;
        // Matrix's solutionSet/session are held server-side and expire on their
        // own schedule, so a cached entry can outlive the engine state it
        // points at. Re-run the original search and re-locate this itinerary by
        // the flight numbers it flies, then retry.
        let fresh = null;
        try {
          fresh = await client.search({ ...detailArgs, pageSize: entry.pageSize });
        } catch {
          /* report the original failure below, not this one */
        }

        const want = signature(target);
        const match = (fresh?.solutionList?.solutions || [])
          .map(normalizeSolution)
          .find((s) => signature(s) === want);

        if (!match) {
          return fail(
            `That itinerary is no longer available from Matrix (its pricing ` +
              `session expired, and re-running the search did not turn it up — ` +
              `fares and schedules move). Run search_flights again for current ` +
              `options. Original error: ${e.message}`
          );
        }

        entry.solutionSet = fresh.solutionSet;
        entry.session = fresh.session;
        target.id = match.id;
        raw = await client.detail({
          ...detailArgs,
          solutionSet: fresh.solutionSet,
          session: fresh.session,
          solutionId: match.id,
        });
      }

      const header =
        `#${rank}  ${target.priceDisplay}  ·  ${hm(target.totalDurationMinutes)} total\n\n`;
      return text(header + renderDetail(raw.bookingDetails, { itinerary: null }));
    } catch (e) {
      return handle(e);
    }
  }
);

server.registerTool(
  "search_flexible_dates",
  {
    title: "Find the cheapest dates",
    description:
      "Scan a range of departure dates and report the cheapest fare on each, " +
      "to find when to fly. Runs one search per date, so keep ranges modest " +
      "(a 14-day scan takes several minutes). For a single date with " +
      "±flexibility, use search_flights with flexDays instead.",
    inputSchema: {
      origin: z.string(),
      destination: z.string(),
      startDate: z.string().describe("First departure date, YYYY-MM-DD."),
      endDate: z.string().describe("Last departure date, YYYY-MM-DD."),
      tripLengthDays: z
        .number()
        .int()
        .min(0)
        .max(60)
        .optional()
        .describe("Nights away for a round-trip. Omit or 0 for one-way."),
      routing: z.string().optional().describe("Routing code applied to every leg."),
      maxDates: z
        .number()
        .int()
        .min(1)
        .max(21)
        .optional()
        .describe("Cap on dates to probe. Default 10."),
      ...commonSchema,
    },
  },
  async (a) => {
    try {
      if (!DATE_RE.test(a.startDate) || !DATE_RE.test(a.endDate)) {
        return fail("startDate and endDate must be YYYY-MM-DD.");
      }
      const start = Date.parse(a.startDate);
      const end = Date.parse(a.endDate);
      if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
        return fail("endDate must be on or after startDate.");
      }

      const cap = a.maxDates ?? 10;
      const dates = [];
      for (let t = start; t <= end && dates.length < cap; t += 86400000) {
        dates.push(new Date(t).toISOString().slice(0, 10));
      }
      const span = Math.round((end - start) / 86400000) + 1;

      const pax = paxFrom(a);
      const rows = [];
      const errors = [];

      for (const d of dates) {
        const legs = [
          buildSlice({
            origin: a.origin,
            destination: a.destination,
            date: d,
            routing: a.routing,
          }),
        ];
        if (a.tripLengthDays) {
          legs.push(
            buildSlice({
              origin: a.destination,
              destination: a.origin,
              date: new Date(Date.parse(d) + a.tripLengthDays * 86400000)
                .toISOString()
                .slice(0, 10),
              routing: a.routing,
            })
          );
        }
        try {
          const raw = await client.search({
            slices: legs,
            pax,
            cabin: a.cabin,
            maxStops: a.maxStops,
            currency: a.currency,
            salesCity: a.salesCity,
            pageSize: 5,
          });
          const best = sortSolutions(
            (raw.solutionList?.solutions || []).map(normalizeSolution),
            "price"
          )[0];
          if (best) {
            rows.push({
              date: d,
              ret: legs[1]?.date ?? null,
              display: best.priceDisplay,
              value: best.price,
              carriers: best.carriers.join("/"),
              dur: best.totalDurationMinutes,
            });
          }
        } catch (e) {
          errors.push(`${d}: ${e.message}`);
        }
      }

      if (!rows.length) {
        return fail(
          "No fares found on any probed date." +
            (errors.length ? `\n${errors.join("\n")}` : "")
        );
      }

      const cheapest = Math.min(...rows.map((r) => r.value ?? Infinity));
      const out = rows
        .sort((x, y) => (x.value ?? Infinity) - (y.value ?? Infinity))
        .map(
          (r) =>
            `${r.date}${r.ret ? ` → ${r.ret}` : ""}  ${r.display}` +
            `${r.value === cheapest ? "  ← cheapest" : ""}  ` +
            `${hm(r.dur)}  ${r.carriers}`
        );

      const notes = [];
      if (dates.length < span) {
        notes.push(
          `Probed the first ${dates.length} of ${span} dates in range (maxDates cap).`
        );
      }
      if (errors.length) notes.push(`${errors.length} date(s) failed: ${errors[0]}`);

      return text(
        [
          `Cheapest fare by departure date (${a.origin}→${a.destination}` +
            `${a.tripLengthDays ? `, ${a.tripLengthDays}-night round-trip` : ", one-way"}):`,
          "",
          ...out,
          ...(notes.length ? ["", ...notes] : []),
        ].join("\n")
      );
    } catch (e) {
      return handle(e);
    }
  }
);

server.registerTool(
  "lookup_airport",
  {
    title: "Look up airport / city codes",
    description:
      "Resolve a partial city or airport name to IATA codes. Use this when " +
      "the user names a place rather than a code, or to find the metro code " +
      "that covers every airport in a city.",
    inputSchema: {
      query: z.string().describe('Partial name or code, e.g. "milan", "JFK".'),
      limit: z.number().int().min(1).max(25).optional(),
    },
  },
  async ({ query, limit }) => {
    try {
      const locs = await client.lookupLocations(query, limit ?? 10);
      if (!locs.length) return text(`No matches for "${query}".`);
      return text(
        locs
          .map(
            (l) =>
              `${l.code}  ${l.displayName || l.name || ""}` +
              `${l.type ? `  (${l.type.toLowerCase()})` : ""}` +
              `${l.cityCode && l.cityCode !== l.code ? `  city: ${l.cityCode}` : ""}`
          )
          .join("\n")
      );
    } catch (e) {
      return handle(e);
    }
  }
);

server.registerTool(
  "routing_language_reference",
  {
    title: "ITA routing language reference",
    description:
      "Full syntax for the `routing` and `extraCodes` fields: carrier " +
      "pinning, forced connection points, alliances, exclusions, stop counts, " +
      "and fare-bucket filters. Read this before composing a non-trivial " +
      "routing code.",
    inputSchema: {},
  },
  async () => text(ROUTING_REFERENCE)
);

  return server;
}

