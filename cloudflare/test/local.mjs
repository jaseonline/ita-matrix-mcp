/**
 * End-to-end check against a running Worker (wrangler dev, or a deployed URL).
 *
 *   BASE=http://localhost:8799 SECRET=<secret> node test/local.mjs
 *   LIVE=1 ...   also run real Matrix searches (slow: 20-60s each)
 *
 * Speaks plain MCP JSON-RPC over Streamable HTTP, the way a connector would.
 */
const BASE = (process.env.BASE || "http://localhost:8799").replace(/\/$/, "");
const SECRET = process.env.SECRET || "localtestsecret0123456789abcdef";
const LIVE = process.env.LIVE === "1";
const URL_ = `${BASE}/mcp/${SECRET}`;

let id = 0;
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

async function rpc(method, params, { path = URL_, notify = false } = {}) {
  const body = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
  if (!notify) body.id = ++id;
  const t0 = Date.now();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let msg = null;
  if ((res.headers.get("content-type") || "").includes("text/event-stream")) {
    for (const block of raw.split("\n\n")) {
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (line) {
        try {
          const j = JSON.parse(line.slice(5));
          if (j.id === body.id) msg = j;
        } catch {}
      }
    }
  } else if (raw) {
    try { msg = JSON.parse(raw); } catch {}
  }
  return { status: res.status, ms: Date.now() - t0, msg, raw };
}

const call = (name, args) => rpc("tools/call", { name, arguments: args });
const textOf = (r) => r.msg?.result?.content?.map((c) => c.text).join("\n") ?? "";

// --- plumbing ---------------------------------------------------------------
let r = await fetch(`${BASE}/health`);
ok(r.status === 200, "GET /health -> 200");

r = await fetch(`${BASE}/mcp`, { method: "POST", body: "{}" });
ok(r.status === 404, `POST /mcp (no secret) -> 404 (got ${r.status})`);

r = await fetch(`${BASE}/mcp/wrong`, { method: "POST", body: "{}" });
ok(r.status === 404, `POST /mcp/wrong -> 404 (got ${r.status})`);

// --- protocol ---------------------------------------------------------------
r = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "local-test", version: "0" },
});
ok(r.status === 200 && r.msg?.result?.serverInfo?.name === "ita-matrix", `initialize -> serverInfo ita-matrix (HTTP ${r.status})`);
ok(/Searches ITA Matrix/.test(r.msg?.result?.instructions || ""), "initialize carries server instructions");

await rpc("notifications/initialized", undefined, { notify: true });

r = await rpc("tools/list");
const names = (r.msg?.result?.tools || []).map((t) => t.name).sort();
const want = ["get_itinerary_details", "lookup_airport", "routing_language_reference", "search_flexible_dates", "search_flights"];
ok(JSON.stringify(names) === JSON.stringify(want), `tools/list -> ${names.join(", ")}`);
const sf = (r.msg?.result?.tools || []).find((t) => t.name === "search_flights");
ok(sf?.inputSchema?.properties?.slices?.maxItems === 6, "search_flights schema: slices maxItems 6");

// --- offline tool ------------------------------------------------------------
r = await call("routing_language_reference", {});
ok(/HOW THE GRAMMAR WORKS/.test(textOf(r)), "routing_language_reference returns the reference");

// --- validation errors (no upstream call) ------------------------------------
r = await call("search_flights", { slices: [{ origin: "LHR", destination: "JFK", date: "10/12/2026" }] });
ok(r.msg?.result?.isError === true && /YYYY-MM-DD/.test(textOf(r)), "search_flights rejects a bad date");

r = await call("get_itinerary_details", { searchId: "s-000000000000", rank: 1 });
ok(r.msg?.result?.isError === true && /Unknown Search ID/.test(textOf(r)), "get_itinerary_details: unknown ID handled");

// --- live tools ----------------------------------------------------------------
if (LIVE) {
  r = await call("lookup_airport", { query: "milan", limit: 5 });
  console.log(`      lookup_airport ${r.ms}ms:\n${textOf(r).split("\n").map((l) => "      " + l).join("\n")}`);
  ok(!r.msg?.result?.isError && /MIL|MXP|LIN/.test(textOf(r)), "lookup_airport 'milan' finds Milan airports");

  const date = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  r = await call("search_flights", { slices: [{ origin: "LHR", destination: "JFK", date }], limit: 5 });
  const txt = textOf(r);
  console.log(`      search_flights ${r.ms}ms:\n${txt.split("\n").slice(0, 14).map((l) => "      " + l).join("\n")}`);
  const sid = txt.match(/\bs-[0-9a-f]{12}\b/)?.[0];
  ok(!r.msg?.result?.isError && !!sid, `search_flights returns itineraries and a Search ID (${sid})`);

  if (sid) {
    r = await call("get_itinerary_details", { searchId: sid, rank: 1 });
    const d = textOf(r);
    console.log(`      get_itinerary_details ${r.ms}ms:\n${d.split("\n").slice(0, 24).map((l) => "      " + l).join("\n")}`);
    ok(!r.msg?.result?.isError && /Agent brief/.test(d) && /Links:/.test(d), "get_itinerary_details returns detail, agent brief and links");
    ok(/fare|Fare/.test(d), "detail mentions fare basis (check the output above for real codes)");
  }

  r = await call("search_flexible_dates", { origin: "LHR", destination: "JFK", startDate: date, endDate: new Date(Date.parse(date) + 2 * 86400000).toISOString().slice(0, 10), maxDates: 3 });
  console.log(`      search_flexible_dates ${r.ms}ms:\n${textOf(r).split("\n").map((l) => "      " + l).join("\n")}`);
  ok(!r.msg?.result?.isError && /cheapest/i.test(textOf(r)), "search_flexible_dates reports cheapest dates");
} else {
  console.log("SKIP  live tools (set LIVE=1)");
}

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
