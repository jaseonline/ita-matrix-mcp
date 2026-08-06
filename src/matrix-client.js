/**
 * Transport for ITA Matrix.
 *
 * Matrix is a Google "Alkali" app fronting the old QPX fare engine. Every call
 * is a single POST to content-alkalimatrix-pa.googleapis.com/batch, with the
 * real JSON-RPC request wrapped in a multipart/mixed envelope. Auth is the
 * public API key from the page — no cookies, no OAuth, no bot token.
 *
 * Three RPCs matter:
 *   POST /v1/search     — run a fare search
 *   POST /v1/summarize  — expand one solution (fare classes, aircraft, RBDs)
 *   GET  /v1/locationTypes/... — airport/city autocomplete
 */

import { KeyProvider } from "./keys.js";

const BATCH_URL = "https://content-alkalimatrix-pa.googleapis.com/batch";
const ORIGIN = "https://matrix.itasoftware.com";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

// Summarizers are Matrix's server-side result aggregators. solutionList is the
// itinerary list itself; the rest power the UI's filter rails. We ask only for
// what we render, since each one costs engine time.
const SEARCH_SUMMARIZERS = ["solutionList", "itineraryCarrierList"];

// Matrix spells premium economy with a hyphen on the wire while every other
// cabin uses the plain enum form. Accept anything reasonable from callers.
const CABIN_WIRE = {
  COACH: "COACH",
  ECONOMY: "COACH",
  PREMIUM_COACH: "PREMIUM-COACH",
  "PREMIUM-COACH": "PREMIUM-COACH",
  PREMIUM_ECONOMY: "PREMIUM-COACH",
  PREMIUM: "PREMIUM-COACH",
  BUSINESS: "BUSINESS",
  FIRST: "FIRST",
};

export function normalizeCabin(cabin) {
  if (!cabin) return "COACH";
  return CABIN_WIRE[String(cabin).toUpperCase().trim()] || "COACH";
}

const boundary = () =>
  "batch" + Math.floor(Math.random() * 1e18).toString().padStart(19, "0");

const splitCodes = (s) =>
  String(s)
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

const ALKALI_HEADERS = [
  "x-alkali-application-key: applications/matrix",
  "x-alkali-auth-apps-namespace: alkali_v2",
  "x-alkali-auth-entities-namespace: alkali_v2",
  "X-Requested-With: XMLHttpRequest",
];

function envelope({ method, path, key, body, bound }) {
  const head = [
    `--${bound}`,
    "Content-Type: application/http",
    "Content-Transfer-Encoding: binary",
    `Content-ID: <${bound}+gapiRequest@googleapis.com>`,
    "",
    `${method} ${path}${path.includes("?") ? "&" : "?"}key=${key}${
      method === "POST" ? "&alt=json" : ""
    }`,
    ...ALKALI_HEADERS,
  ];
  const tail =
    method === "POST"
      ? ["Content-Type: application/json", "", JSON.stringify(body)]
      : ["", ""];
  return [...head, ...tail, `--${bound}--`, ""].join("\r\n");
}

/** The response is multipart too; the payload is the one JSON object inside. */
function unwrap(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error(`Matrix returned no JSON body: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

export class MatrixError extends Error {
  constructor(message, { kind = "api", retryable = false } = {}) {
    super(message);
    this.name = "MatrixError";
    this.kind = kind;
    this.retryable = retryable;
  }
}

/**
 * Build one slice (leg) of the trip.
 *
 * `routing` is ITA's routing language and is the whole reason this tool beats
 * a normal flight search — see README. `commandLine` is the companion
 * extension-code field (fare-bucket filters and the like).
 */
export function buildSlice({
  origin,
  destination,
  date,
  flexMinus = 0,
  flexPlus = 0,
  isArrivalDate = false,
  routing = null,
  commandLine = null,
  departAfter = null,
  departBefore = null,
}) {
  const s = {
    origins: splitCodes(origin),
    destinations: splitCodes(destination),
    date,
    dateModifier: { minus: flexMinus, plus: flexPlus },
    isArrivalDate,
    filter: { warnings: { values: [] } },
    selected: false,
  };
  if (routing) s.routeLanguage = routing;
  if (commandLine) s.commandLine = commandLine;
  if (departAfter || departBefore) {
    s.timeRanges = [{ min: departAfter || "00:00", max: departBefore || "23:59" }];
  }
  return s;
}

export class MatrixClient {
  constructor({ timeoutMs = 150000, fetchImpl = fetch } = {}) {
    this._timeout = timeoutMs;
    this._fetch = fetchImpl;
    this._keys = new KeyProvider({
      fetchImpl,
      validate: (key) => this._probeKey(key),
    });
  }

  /** Cheap authorized call used to decide whether a candidate key works. */
  async _probeKey(key) {
    const j = await this._raw({
      method: "GET",
      path:
        "/v1/locationTypes/CITIES_AND_AIRPORTS/partialNames/lond/locations?pageSize=1",
      key,
      timeoutMs: 15000,
    });
    return !j.error && Array.isArray(j.locations);
  }

  async _raw({ method, path, key, body, timeoutMs }) {
    const bound = boundary();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs ?? this._timeout);
    let res;
    try {
      res = await this._fetch(
        `${BATCH_URL}?%24ct=multipart%2Fmixed%3B%20boundary%3D${bound}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "text/plain; charset=UTF-8",
            Origin: ORIGIN,
            Referer: ORIGIN + "/",
            Accept: "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": UA,
          },
          body: envelope({ method, path, key, body, bound }),
          signal: ctrl.signal,
        }
      );
    } catch (e) {
      if (e.name === "AbortError") {
        throw new MatrixError(
          `Matrix did not respond within ${Math.round(
            (timeoutMs ?? this._timeout) / 1000
          )}s. Complex multi-city searches are slow; try fewer legs, ` +
            `maxStops=0, or a narrower routing code.`,
          { kind: "timeout", retryable: true }
        );
      }
      throw new MatrixError(`Network error talking to Matrix: ${e.message}`, {
        kind: "network",
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok && res.status >= 500) {
      throw new MatrixError(`Matrix HTTP ${res.status}`, {
        kind: "upstream",
        retryable: true,
      });
    }
    return unwrap(await res.text());
  }

  /**
   * Send a call, healing the two failure modes worth retrying: a rotated API
   * key, and Matrix's intermittent "service is currently unavailable" (which
   * clears on its own within a second or two).
   */
  async _call({ method, path, body }) {
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const key = await this._keys.get();
      const j = await this._raw({ method, path, key, body });

      if (!j.error) return j;

      const msg = j.error.message || JSON.stringify(j.error);

      if (/API key not valid|API_KEY_INVALID|has not been used|blocked/i.test(msg)) {
        if (attempt < 2) {
          await this._keys.invalidate();
          continue;
        }
        throw new MatrixError("Matrix rejected the API key.", { kind: "auth" });
      }

      // Transient upstream wobble — back off briefly and try again.
      if (/currently unavailable|try again|temporarily|internal error/i.test(msg)) {
        lastError = msg;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
          continue;
        }
        throw new MatrixError(
          `Matrix is temporarily unavailable (retried 3x): ${msg}`,
          { kind: "upstream", retryable: true }
        );
      }

      throw new MatrixError(this._explain(msg), { kind: "api" });
    }

    throw new MatrixError(
      `Matrix call failed after retries${lastError ? `: ${lastError}` : "."}`,
      { kind: "upstream", retryable: true }
    );
  }

  /** Turn the engine's raw Java-ish errors into something actionable. */
  _explain(msg) {
    if (/cannot sort by price/i.test(msg)) {
      return (
        "Matrix cannot sort multi-leg trips server-side. " +
        "(This is handled automatically — please report if you see it.)"
      );
    }
    if (/routeLanguage|routing/i.test(msg) && /pars|syntax|invalid/i.test(msg)) {
      return `Matrix rejected the routing code: ${msg}`;
    }
    if (/no.*(solution|itinerar)/i.test(msg)) {
      return `Matrix found no itineraries: ${msg}`;
    }
    return `Matrix error: ${msg}`;
  }

  /**
   * Run a search. `slices` may be any length: 1 = one-way, 2 = round-trip,
   * 3+ = multi-city / open-jaw.
   */
  async search({
    slices,
    pax = { adults: 1 },
    cabin = "COACH",
    maxStops = null,
    pageSize = 30,
    currency = null,
    salesCity = null,
    changeOfAirport = true,
  }) {
    if (!slices?.length) throw new MatrixError("At least one slice is required.");

    const inputs = {
      filter: {},
      page: { current: 1, size: pageSize },
      pax,
      slices,
      firstDayOfWeek: "SUNDAY",
      internalUser: false,
      sliceIndex: 0,
      // The engine refuses server-side price sort on multi-slice trips, and
      // "default" is always accepted. We sort client-side regardless, so this
      // costs nothing and avoids a whole class of 400s.
      sorts: "default",
      cabin: normalizeCabin(cabin),
      maxLegsRelativeToMin: maxStops == null ? 1 : maxStops,
      changeOfAirport,
      checkAvailability: true,
    };
    if (currency) inputs.currency = String(currency).toUpperCase();
    if (salesCity) inputs.salesCity = String(salesCity).toUpperCase();

    return this._call({
      method: "POST",
      path: "/v1/search",
      body: {
        summarizers: SEARCH_SUMMARIZERS,
        inputs,
        summarizerSet: "wholeTrip",
        name: "specificDatesSlice",
      },
    });
  }

  /**
   * Expand one solution into per-segment booking detail: fare basis codes,
   * RBD booking classes, aircraft types.
   *
   * Reuses the `session` + `solutionSet` from a prior search, so this is fast
   * (no re-run of the fare engine).
   */
  async detail({
    solutionSet,
    session,
    solutionId,
    slices,
    pax = { adults: 1 },
    cabin = "COACH",
    maxStops = null,
    currency = null,
    salesCity = null,
  }) {
    const inputs = {
      filter: {},
      page: { current: 1, size: 25 },
      pax,
      slices,
      firstDayOfWeek: "SUNDAY",
      internalUser: false,
      sliceIndex: 0,
      sorts: "default",
      solution: `${solutionSet}/${solutionId}`,
      cabin: normalizeCabin(cabin),
      maxLegsRelativeToMin: maxStops == null ? 1 : maxStops,
      changeOfAirport: true,
      checkAvailability: true,
    };
    if (currency) inputs.currency = String(currency).toUpperCase();
    if (salesCity) inputs.salesCity = String(salesCity).toUpperCase();

    return this._call({
      method: "POST",
      path: "/v1/summarize",
      body: {
        summarizers: ["bookingDetails"],
        inputs,
        summarizerSet: "viewDetails",
        solutionSet,
        session,
      },
    });
  }

  /** Autocomplete a partial city/airport name to IATA codes. */
  async lookupLocations(query, limit = 10) {
    const j = await this._call({
      method: "GET",
      path:
        `/v1/locationTypes/CITIES_AND_AIRPORTS/partialNames/` +
        `${encodeURIComponent(query)}/locations?pageSize=${limit}`,
    });
    return j.locations || [];
  }
}
