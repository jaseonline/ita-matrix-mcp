/**
 * End-to-end check over a real MCP client/server pair.
 *
 * Offline by default: only asserts the server starts, registers its tools and
 * validates input. Set ITA_MATRIX_LIVE=1 to also hit the real Matrix engine
 * (slow — a multi-city search takes 20-60s).
 */

import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const LIVE = process.env.ITA_MATRIX_LIVE === "1";
let failures = 0;

function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["src/server.js"],
  stderr: "pipe",
});
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
console.log("tools:", names.join(", "), "\n");

for (const expected of [
  "search_flights",
  "get_itinerary_details",
  "search_flexible_dates",
  "lookup_airport",
  "routing_language_reference",
]) {
  check(`tool registered: ${expected}`, names.includes(expected));
}

// The slices array is the whole point — make sure it survived schema generation.
const search = tools.find((t) => t.name === "search_flights");
check(
  "search_flights takes a slices array",
  search?.inputSchema?.properties?.slices?.type === "array"
);
check(
  "slice exposes a routing field",
  !!search?.inputSchema?.properties?.slices?.items?.properties?.routing
);

const ref = await client.callTool({
  name: "routing_language_reference",
  arguments: {},
});
check(
  "routing reference returns content",
  ref.content?.[0]?.text?.includes("ROUTING CODES"),
  `${ref.content?.[0]?.text?.length ?? 0} chars`
);

// Bad input should come back as a clean tool error, not a crash.
const bad = await client.callTool({
  name: "search_flights",
  arguments: { slices: [{ origin: "JFK", destination: "LAX", date: "next tuesday" }] },
});
check(
  "rejects malformed date gracefully",
  bad.isError === true && /YYYY-MM-DD/.test(bad.content?.[0]?.text || ""),
  (bad.content?.[0]?.text || "").slice(0, 60)
);

const unknown = await client.callTool({
  name: "get_itinerary_details",
  arguments: { searchId: "nope", rank: 1 },
});
check(
  "unknown search id is handled",
  unknown.isError === true && /Unknown Search ID/.test(unknown.content?.[0]?.text || "")
);

if (LIVE) {
  console.log("\n--- live ---");

  const loc = await client.callTool({
    name: "lookup_airport",
    arguments: { query: "milan", limit: 5 },
  });
  check("lookup_airport hits Matrix", /MIL|MXP|LIN/.test(loc.content?.[0]?.text || ""),
    (loc.content?.[0]?.text || "").split("\n")[0]);

  const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const multi = await client.callTool({
    name: "search_flights",
    arguments: {
      slices: [
        { origin: "JFK", destination: "LHR", date: d(70) },
        { origin: "CDG", destination: "JFK", date: d(78) },
      ],
      cabin: "COACH",
      limit: 3,
    },
  });
  const body = multi.content?.[0]?.text || "";
  check("multi-city (open-jaw) search returns fares", !multi.isError && /#1/.test(body),
    body.split("\n")[0]);
  console.log(body.slice(0, 700));

  const id = body.match(/Search ID: (\S+)/)?.[1];
  if (id) {
    const det = await client.callTool({
      name: "get_itinerary_details",
      arguments: { searchId: id, rank: 1 },
    });
    const dt = det.content?.[0]?.text || "";
    check("details resolve booking classes", !det.isError && /Leg 1/.test(dt),
      dt.split("\n")[0]);
    console.log(dt.slice(0, 500));
  }
}

await client.close();
console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
