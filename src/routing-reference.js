/**
 * ITA routing-language cheat sheet, served by the routing_language_reference
 * tool.
 *
 * Sourced from Google's official "Using the ITA Routing Codes" documentation.
 * Forms marked "unverified" were not exercised against the live engine, so
 * prefer the verified ones and fall back if the engine rejects a code.
 */

export const ROUTING_REFERENCE = `ITA MATRIX ROUTING LANGUAGE

Two separate per-leg fields:
  routing     -> routing codes: which carriers, which connection points
  extraCodes  -> extension codes: connection times, alliances, fare buckets

Codes apply per leg. In a multi-city trip each slice carries its own codes;
a code on leg 1 says nothing about leg 3.

--- ROUTING CODES (the "routing" field) ---

Carriers (2-letter IATA):
  AA              prefer/allow American
  AA+             one or more AA flights (this is the usual "only AA" form)
  AA*             zero or more AA flights
  AA,UA           alternatives — American or United (official comma form)
  C:AA            AA as the MARKETING carrier (the code on your ticket)
  O:AA            AA as the OPERATING carrier (who actually flies it)
  ~AA             exclude American
  ~AA,BA+         exclude both American and British Airways

Connection points (3-letter IATA):
  DFW             may transit Dallas-Fort Worth
  DFW+            must transit DFW
  ~ORD            never route through Chicago O'Hare

Sequences — tokens match flights in order:
  AA+ DFW AA+     American, connecting at DFW, American onward
  DL DL DL        exactly three Delta flights
  F               a single flight
  F F             exactly two flights (one connection)
  N               nonstop only

Note: some clients use pipe-alternation "(AA|BA)+" instead of the comma form.
The comma form "AA,BA" is what Google documents; prefer it. (pipe: unverified)

--- EXTENSION CODES (the "extraCodes" field) ---

Connection timing (minutes):
  minconnect 45      at least a 45-minute connection
  maxconnect 300     no connection longer than 5 hours
  padconnect 20      add 20 min to the airline's legal minimum
  maxdur 720         cap total leg duration at 12 hours

Alliances:
  alliance oneworld
  alliance skyteam
  alliance star-alliance

Quality filters:
  -overnight      no overnight connections
  -redeye         no red-eye flights
  -prop           no propeller aircraft

Fare buckets (booking classes / RBDs) — the lever for premium-cabin deals:
  f bc=J          only J-class business fares
  f bc=J|C|D      any of J, C or D
  f bc=Y          full-fare economy only

--- WORKED EXAMPLES ---

"Star Alliance business, no overnights, via a European hub":
  routing: "~ORD"   extraCodes: "alliance star-alliance -overnight"

"All-American Airlines through Dallas":
  routing: "AA+ DFW AA+"

"Anything but a Chicago connection, max 4h layover":
  routing: "~ORD"   extraCodes: "maxconnect 240"

"Marketed by BA but flown by AA" (codeshare hunting):
  routing: "C:BA O:AA"

"Exactly one connection, business buckets only":
  routing: "F F"    extraCodes: "f bc=J|C|D"

--- PRACTICAL NOTES ---

Over-constraining is the usual cause of zero results. If a search comes back
empty, relax in this order: drop extraCodes, loosen the carrier "+", raise
maxStops, then widen dates.

maxStops is relative to the route's minimum, not absolute: 0 means "no more
hops than strictly necessary", which on a long-haul may still be 1 stop.

Metro codes cover every airport in a city: NYC = JFK+LGA+EWR, LON = LHR+LGW+
STN+LCY, TYO = NRT+HND, MOW, PAR, MIL, WAS, CHI, ROM, BUE, SAO.`;
