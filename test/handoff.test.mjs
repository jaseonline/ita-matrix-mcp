/**
 * Offline checks for the hand-over helpers. The fixture follows the
 * bookingDetails shape that ita-matrix-powertools parses (fare codes under
 * tickets[].pricings[].fares[], keyed by segment origin/destination/class) and
 * mirrors the DUB-SYD First fare found on 2027-06-11. The fare codes are
 * placeholders, not real filings.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { flatten, buildLinks, agentBrief, fareMap } from "../src/handoff.js";
import { renderDetail } from "../src/format.js";

const seg = (carrier, number, o, d, dep, arr, cabin, code) => ({
  carrier: { code: carrier },
  flight: { number },
  origin: { code: o },
  destination: { code: d },
  departure: dep,
  arrival: arr,
  duration: 450,
  bookingInfos: [{ bookingCode: code, cabin }],
  legs: [{ aircraft: { shortName: "Boeing 777" } }],
});

const booking = {
  itinerary: {
    slices: [
      {
        origin: { code: "DUB" },
        destination: { code: "SYD" },
        departure: "2027-06-11T14:20",
        arrival: "2027-06-12T22:05",
        segments: [
          seg("QF", 8162, "DUB", "DXB", "2027-06-11T14:20", "2027-06-12T00:50", "FIRST", "A"),
          seg("QF", 8414, "DXB", "SYD", "2027-06-12T02:15", "2027-06-12T22:05", "FIRST", "A"),
        ],
      },
      {
        origin: { code: "SYD" },
        destination: { code: "DUB" },
        departure: "2027-06-25T06:00",
        arrival: "2027-06-25T20:05",
        segments: [
          seg("QF", 8415, "SYD", "DXB", "2027-06-25T06:00", "2027-06-25T14:10", "FIRST", "A"),
          seg("QF", 8163, "DXB", "DUB", "2027-06-25T15:10", "2027-06-25T20:05", "FIRST", "A"),
        ],
      },
    ],
  },
  tickets: [
    {
      pricings: [
        {
          fares: [
            {
              carrier: "QF",
              code: "AFXTEST",
              bookingInfos: [
                { bookingCode: "A", segment: { origin: "DUB", destination: "DXB" } },
                { bookingCode: "A", segment: { origin: "DXB", destination: "SYD" } },
              ],
            },
            {
              carrier: "QF",
              code: "AFXTESTR",
              bookingInfos: [
                { bookingCode: "A", segment: { origin: "SYD", destination: "DXB" } },
                { bookingCode: "A", segment: { origin: "DXB", destination: "DUB" } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

test("fare basis is resolved from tickets, not bookingInfos", () => {
  assert.equal(fareMap(booking).get("DUBDXBA").code, "AFXTEST");
  const text = renderDetail(booking);
  assert.match(text, /QF8162\s+DUB→DXB.*RBD A\s+fare AFXTEST/);
  assert.match(text, /QF8163\s+DXB→DUB.*fare AFXTESTR/);
});

test("agent brief lists one line per flight with class, date and fare", () => {
  const lines = agentBrief(flatten(booking));
  assert.equal(lines.length, 4);
  assert.equal(lines[0], "QF 8162 A 11JUN DUBDXB 1420 0050  AFXTEST");
});

test("QF link pins flight numbers and booking class", () => {
  const url = buildLinks(flatten(booking), { adults: 1 }).find((l) => l.name === "Qantas").url;
  assert.match(url, /sdcFlightNumber11=QF8162/);
  assert.match(url, /sdcSegmentRbd22=A/);
  assert.match(url, /travelClass=FIR/);
  assert.match(url, /travelDates=202706110000%2C202706250000/);
});

test("BA link only when BA, IB or EI is flown; QF and GCM always sensible", () => {
  const links = buildLinks(flatten(booking), { adults: 1 });
  assert.ok(!links.some((l) => l.name === "British Airways"));
  assert.ok(links.some((l) => l.name === "Route map" && l.url.endsWith("DUB-DXB-SYD;SYD-DXB-DUB;")));
  assert.ok(links.some((l) => l.name === "Where to Credit" && l.url.includes("DUB-DXB-QF-A/DXB-SYD-QF-A")));

  const ba = JSON.parse(JSON.stringify(booking));
  ba.itinerary.slices[0].segments[0].carrier.code = "BA";
  const url = buildLinks(flatten(ba), { adults: 2 }).find((l) => l.name === "British Airways").url;
  // F + adults, youths, children, infants + "LF", then ddmmyyyy HHMM carrier fnr cabin route T
  assert.ok(url.includes("?eId=111054&data=F2000LF110620271420BA8162FDUBDXBT"), url);
});

test("Emirates link is a search link and is skipped for open-jaw", () => {
  const ek = JSON.parse(JSON.stringify(booking));
  ek.itinerary.slices[0].segments[1].carrier.code = "EK";
  const link = buildLinks(flatten(ek), { adults: 1 }).find((l) => l.name.startsWith("Emirates"));
  assert.ok(link.url.includes("seldcity1=DUB&selacity1=SYD&selddate1=11-Jun-27"));
  assert.ok(link.url.endsWith("TID=SB"));

  const jaw = JSON.parse(JSON.stringify(ek));
  jaw.itinerary.slices[1].origin.code = "MEL";
  assert.ok(!buildLinks(flatten(jaw), { adults: 1 }).some((l) => l.name.startsWith("Emirates")));
});

test("incomplete bookingDetails yields no links rather than throwing", () => {
  assert.deepEqual(buildLinks(flatten({}), { adults: 1 }), []);
  assert.deepEqual(buildLinks(flatten({ itinerary: { slices: [{ segments: [{}] }] } }), { adults: 1 }), []);
});
