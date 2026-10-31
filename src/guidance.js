/**
 * MCP prompts and resources: how to get good results out of the tools.
 *
 * The Node server (SDK v1) and the Cloudflare Worker (SDK v2) each run their
 * own create-server.js, so this file is shared by copy, like format.js and
 * handoff.js: edit src/guidance.js and copy it to cloudflare/src/. A test fails
 * if the two differ. It imports nothing from the SDK, and argsSchema stays a
 * raw shape because that is the one form both SDK versions accept.
 *
 * Prompts carry no one's home airport or currency: those are arguments, so the
 * public defaults stay neutral.
 */

import { z } from "zod";

import { ROUTING_REFERENCE } from "./routing-reference.js";

const FARE_STRATEGY = `# ITA Matrix fare strategy

Finding a good fare is mostly methodical variation: the origin, the dates, then
the constraints. Each is a tactic to try, not a guarantee.

## Search order that wastes the least time

Searches take 20-60s and Matrix's rate limits are undocumented, so prefer a few
well-chosen searches to a blind sweep, and run at most three or four at once.

1. A bare search, to confirm the route has fares and see the price level.
2. The same search from two or three alternative origins.
3. A handful of single-date searches across the window on the best origin.
4. Add the alliance, then fare-bucket codes, on the best date.
5. Only then add flight-count or connection-city codes.
6. get_itinerary_details on the final one to three.

Add constraints one at a time. If four went on at once, you cannot tell which
one emptied the results.

## Vary the origin

The starting city is the main price lever. Fares filed from a different country
can be far cheaper for the same long-haul flights, particularly in premium
cabins, so run the same trip from nearby hubs as well as the home airports.

salesCity is not a substitute. It mostly sets the default currency, and a live
test with two points of sale returned identical fares. Set currency explicitly
so that prices from different origins are comparable.

## Vary the dates

A shift of a few days can move a fare a long way, so report a small date grid
rather than one date. search_flexible_dates runs one search per date and tends
to time out on complex trips (long-haul, alliance-pinned, multi-segment). For
those, run single-date search_flights calls instead, or use flexDays on a slice
(maximum 7).

## Price premium cabins as round trips

A one-way premium fare is often far dearer than half a round trip, so use two
slices, the second reversed. Compare total price rather than base fare, because
carrier surcharges can be a large share of it.

## Pin the alliance, then the fare bucket

extraCodes takes "alliance oneworld", then a bucket filter such as
"alliance oneworld; f bc=J|C|D" alongside the cabin setting. Separate extension
codes with semicolons. The bucket filter is what separates a discounted premium
fare from the same cabin at full price.

## Use open-jaws and multi-city

Legs need not connect, so price into one city and home from another as one
trip. This can save money, and it lets you pass through a hub in one direction
only. Each slice carries its own codes.

## Read mixed cabins correctly

A tag such as [FIRST/BUSINESS] means the cabin varies by segment on one fare.
That is normal: short feeder flights often have no First cabin, so the long-haul
part can still be First. Say which segments are in which cabin. US domestic
First is generally a recliner rather than a lie-flat seat, except on some
premium transcontinental routes.

## Hand over the result

For each recommendation give the flight numbers, dates, booking classes, fare
basis and price with its currency. get_itinerary_details supplies the booking
class and fare basis, which is what a ticketing agent needs.
`;

const RESOURCES = [
  {
    name: "routing-reference",
    uri: "ita://reference/routing",
    title: "ITA routing language reference",
    description: "Syntax for the routing and extraCodes fields, with worked examples.",
    mimeType: "text/plain",
    text: ROUTING_REFERENCE,
  },
  {
    name: "fare-strategy",
    uri: "ita://guides/fare-strategy",
    title: "Fare strategy guide",
    description: "Search order and tactics for finding cheaper fares with Matrix.",
    mimeType: "text/markdown",
    text: FARE_STRATEGY,
  },
];

/** Render "Label: value" lines, skipping arguments the caller left out. */
const given = (pairs) =>
  pairs
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");

const userMessage = (text) => ({
  messages: [{ role: "user", content: { type: "text", text } }],
});

const PROMPTS = [
  {
    name: "plan_trip",
    title: "Plan a trip",
    description:
      "Turn a trip described in plain words into a sequence of Matrix searches, " +
      "ending with the best one to three priced options.",
    argsSchema: {
      trip: z.string().describe('The trip in plain words, e.g. "London to Tokyo in May, home from Osaka".'),
      currency: z.string().optional().describe('ISO 4217 currency, e.g. "EUR".'),
      homeAirports: z.string().optional().describe('Preferred departure airports, e.g. "LHR,LGW".'),
      cabin: z.string().optional().describe("COACH, PREMIUM_COACH, BUSINESS or FIRST."),
    },
    build: ({ trip, currency, homeAirports, cabin }) =>
      userMessage(
        [
          "Plan this trip with the ITA Matrix tools.",
          "",
          `Trip: ${trip}`,
          given([
            ["Currency", currency],
            ["Home airports", homeAirports],
            ["Cabin", cabin],
          ]),
          "",
          "1. Ask one short question only if the answer would change which searches you run. " +
            "Otherwise state your assumptions and carry on.",
          "2. Resolve place names with lookup_airport.",
          "3. Run a bare search_flights first to see what exists and roughly what it costs. " +
            "Model a return as two slices and a multi-city trip as one slice per leg.",
          "4. Add routing or extraCodes constraints one at a time, reading " +
            "routing_language_reference before writing a non-trivial code.",
          "5. Run get_itinerary_details on anything you recommend.",
          "6. Lead with the best one to three options in a table of price, dates, carriers, " +
            "flight numbers, stops and booking class, followed by the Search ID.",
        ]
          .filter((l, i, all) => l || all[i - 1])
          .join("\n")
      ),
  },
  {
    name: "hunt_premium_fare",
    title: "Hunt for a premium-cabin fare",
    description:
      "Look for a cheap business or first fare by varying the origin, then " +
      "narrowing by alliance and fare bucket.",
    argsSchema: {
      destination: z.string().describe('Where to, e.g. "SYD" or "Sydney".'),
      dates: z.string().describe('Outbound and return dates or a window, e.g. "12-26 March 2027".'),
      cabin: z.string().optional().describe("BUSINESS or FIRST. Default BUSINESS."),
      homeAirports: z.string().optional().describe('Usual departure airports, e.g. "LHR,LGW".'),
      alternativeOrigins: z
        .string()
        .optional()
        .describe('Other origins to compare, e.g. "DUB,AMS,CPH". Default: choose nearby hubs.'),
      alliance: z.string().optional().describe("oneworld, skyteam or star-alliance."),
      currency: z.string().optional().describe('ISO 4217 currency, e.g. "EUR".'),
    },
    build: ({ destination, dates, cabin, homeAirports, alternativeOrigins, alliance, currency }) =>
      userMessage(
        [
          `Hunt for a cheap ${cabin || "BUSINESS"} fare to ${destination}, ${dates}.`,
          given([
            ["Home airports", homeAirports],
            ["Alternative origins", alternativeOrigins || "choose a few nearby major hubs"],
            ["Alliance", alliance],
            ["Currency", currency],
          ]),
          "",
          "Read ita://guides/fare-strategy if your client can, then:",
          "1. Price a round trip (two slices, the second reversed), since one-way premium fares " +
            "are often far dearer than half a return.",
          "2. Run a bare search from the home airports to set the baseline.",
          "3. Run the same search from the alternative origins, three or four at a time. " +
            "The origin is the main price lever; salesCity is not.",
          "4. On the cheapest origin, try a few single dates across the window. Avoid " +
            "search_flexible_dates here, because it tends to time out on long-haul trips.",
          "5. Add the alliance, then fare buckets (for example \"f bc=J|C|D\"), one change per run.",
          "6. Run get_itinerary_details on the best one to three, and state which segments are " +
            "in the premium cabin and which are not.",
          "7. Compare on total price, and give the saving against the home-airport baseline.",
        ].join("\n")
      ),
  },
  {
    name: "explain_empty_search",
    title: "Explain an empty search",
    description:
      "Work out why a search returned nothing by relaxing one constraint at a " +
      "time, then checking whether Matrix itself is responding.",
    argsSchema: {
      searchDescription: z
        .string()
        .describe("The failing search: its route, dates, cabin, routing, extraCodes and maxStops."),
    },
    build: ({ searchDescription }) =>
      userMessage(
        [
          "This ITA Matrix search returned nothing. Find out why.",
          "",
          `Search: ${searchDescription}`,
          "",
          "Check first whether a bare carrier or airport is fixing the flight count: \"AA\" means " +
            "exactly one flight and \"~ORD\" means exactly one connection, so it drops nonstops.",
          "",
          "Then relax in this order, one change per re-run, and stop when fares appear:",
          "1. Drop extraCodes.",
          "2. Pad the routing code (AA to AA+, DFW to F? DFW F?).",
          "3. Raise maxStops, which is relative to the route minimum (maximum 4).",
          "4. Widen the dates with flexDays (per slice, maximum 7).",
          "5. Try nearby airports or a metro code.",
          "",
          "If it is still empty, run a control search on a busy route, such as LHR to VIE in " +
            "economy about a month out. If that also returns nothing, the likely cause is " +
            "Matrix or a block on this server rather than the search, so say that instead of " +
            "concluding there are no fares.",
          "",
          "Report which constraint caused the empty result and the closest working search.",
        ].join("\n")
      ),
  },
];

export function registerGuidance(server) {
  for (const { name, uri, title, description, mimeType, text } of RESOURCES) {
    server.registerResource(name, uri, { title, description, mimeType }, async (u) => ({
      contents: [{ uri: u.href, mimeType, text }],
    }));
  }

  for (const { name, title, description, argsSchema, build } of PROMPTS) {
    server.registerPrompt(name, { title, description, argsSchema }, async (args) => build(args));
  }
}
