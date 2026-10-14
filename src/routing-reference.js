/**
 * ITA routing-language cheat sheet, served by the routing_language_reference
 * tool.
 *
 * Sourced from Google's official "Using the ITA Routing Codes" General Rules.
 * Items marked (verified) were run against the live engine; the rest follow
 * Google's documentation but were not exercised here. If the engine rejects a
 * code, fall back to a verified form.
 */

export const ROUTING_REFERENCE = `ITA MATRIX ROUTING LANGUAGE

Two separate per-leg fields:
  routing     -> routing codes: which carriers, which connection points
  extraCodes  -> extension codes: connection times, alliances, fare buckets

Codes apply per leg. In a multi-city trip each slice carries its own codes;
a code on leg 1 says nothing about leg 3.

--- HOW THE GRAMMAR WORKS (read this first) ---

Each space-separated token is ONE flight segment or ONE connection point,
matched in order. The code restricts results to exactly as many segments as
you write, unless a quantifier says otherwise:
  +   one or more      *   zero or more      ?   zero or one

So a bare carrier or airport FIXES the flight count:
  AA     exactly one direct flight marketed by American. Not "prefer".
  DFW    exactly one connection, in Dallas-Fort Worth, and no other.
  ~ORD   exactly one connection, anywhere except Chicago O'Hare. This drops
         nonstops and itineraries with 2+ connections.
To allow extra flights around a constraint, pad it with F?, F* or F+.

--- ROUTING CODES (the "routing" field) ---

Carriers (2-letter IATA; unprefixed means marketing carrier):
  AA              exactly one direct flight marketed by AA        (verified)
  AA+             one or more flights, all AA                     (verified)
  AA*             zero or more AA flights
  AA,UA,DL        any of these carriers; commas, NO spaces
  C:AA            AA as the MARKETING carrier (the code on your ticket)
  O:AA            AA as the OPERATING carrier (who actually flies it)
  ~UA             exactly one direct flight, not on United
  ~UA+            zero or more connections, none on United
  ~AA,BA+         no flights on American or British Airways

Connection points (3-letter IATA):
  DFW or X:DFW    exactly one connection, in DFW                  (verified)
  ~DFW            exactly one connection, not in DFW              (verified)
  DFW,DEN         exactly one connection, in either
  X               any one connection point
  X+              one or more connection points
  X X             exactly two connections
  X? X?           two connections or fewer
  F? DFW F?       connect in DFW, other connections also allowed

  Note: X: marks a connection point. X:LAX means connect in LAX; to avoid
  LAX use ~LAX.

Sequences (tokens match flights and connections in order):
  AA+ DFW AA+     American, connecting at DFW, American onward
  DL DL DL        exactly three Delta flights
  F               one direct flight (one flight number; may have a stop)
  F F             exactly two flights (one connection)             (verified)
  F F F           exactly three flights                            (verified)
  N               nonstop only
  N:UA            nonstop on United
  F* AA F*        at least one AA flight, anything else allowed
  F+ AA F+        at least one AA flight, plus other flights
  N DFW,DEN N     connect only in DFW or DEN
  DEN,ATL DEN,ATL a stop in Denver and Atlanta, in either order
  Each token is a separate flight: "C:BA O:AA" is TWO flights (the first
  marketed by BA, the second operated by AA), not one BA-marketed AA flight.

Flight numbers:
  UA882           a particular flight
  ~UA882+         any flights except UA882
  UA1000-2000+    one or more UA flights numbered 1000-2000

Countries use two-letter ISO codes, e.g. "~l:nUS+" excludes connections in
the United States (stops on direct flights are not excluded).

--- EXTENSION CODES (the "extraCodes" field) ---

SEPARATE SEVERAL CODES WITH A SEMICOLON, e.g. "alliance oneworld; -overnight"
(verified). A space between codes fails: Matrix reads "-overnight" as part of
the alliance name and returns a QPX error. Google's examples prefix extension
codes with "/"; in this tool leave the "/" out.

Connection timing (minutes):
  minconnect 45      at least a 45-minute connection
  maxconnect 120     no connection longer than 2 hours
  padconnect 20      add 20 min to the airline's recommended minimum
  maxdur 240         cap total itinerary duration at 4 hours

Alliances:
  alliance oneworld                                                (verified)
  alliance skyteam
  alliance star-alliance

Quality filters:
  -overnight      no overnight stops                               (verified)
  -redeye         no red-eye flights
  -prop           no propeller aircraft

Fare buckets (booking classes / RBDs) - the lever for premium-cabin deals:
  f bc=J          only J-class fares
  f bc=J|C|D      any of J, C or D                                 (verified)
  f bc=Y          full-fare economy only

--- WORKED EXAMPLES ---

"Oneworld business, no overnight stops":
  routing: ""   extraCodes: "alliance oneworld; -overnight"

"All-American Airlines, connecting through Dallas":
  routing: "AA+ DFW AA+"

"Exactly one connection, none in Chicago":
  routing: "~ORD"

"Any number of connections, none in Chicago" (untested, follows the grammar):
  routing: "~ORD*"

"Exactly one connection, business buckets only":
  routing: "F F"    extraCodes: "f bc=J|C|D"

"At least one American flight, anything else allowed":
  routing: "F* AA F*"

--- PRACTICAL NOTES ---

Over-constraining is the usual cause of zero results, and the usual cause of
over-constraining is a bare carrier or airport fixing the flight count. If a
search comes back empty, relax in this order: drop extraCodes, pad the routing
code (AA -> AA+, DFW -> F? DFW F?), raise maxStops, then widen dates.

maxStops is relative to the route's minimum, not absolute: 0 means "no more
hops than strictly necessary", which on a long-haul may still be 1 stop.

Metro codes cover every airport in a city: NYC = JFK+LGA+EWR, LON = LHR+LGW+
STN+LCY, TYO = NRT+HND, MOW, PAR, MIL, WAS, CHI, ROM, BUE, SAO.`;
