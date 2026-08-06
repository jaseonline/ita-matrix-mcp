/**
 * Verifies the HTTP transport end to end: real client, real socket, real
 * session lifecycle. Offline unless ITA_MATRIX_LIVE=1.
 */

import { spawn } from "node:child_process";
import net from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 3899;
const SECRET = "test-secret-path";
const BASE = `http://127.0.0.1:${PORT}`;
const MCP_URL = `${BASE}/mcp/${SECRET}`;

let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
};

const child = spawn(process.execPath, ["src/http-server.js"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    ITA_MATRIX_SECRET_PATH: SECRET,
    ITA_MATRIX_ALLOWED_HOSTS: "127.0.0.1,localhost",
  },
  stdio: ["ignore", "inherit", "pipe"],
});
child.stderr.on("data", (d) => process.stderr.write(`  [server] ${d}`));

// Wait for the listener rather than sleeping a fixed amount.
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("server did not start in 15s")), 15000);
  const tick = async () => {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return clearTimeout(t), resolve();
    } catch {}
    setTimeout(tick, 200);
  };
  tick();
});

const health = await (await fetch(`${BASE}/health`)).json();
check("health endpoint responds", health.status === "ok");

// The secret path is the credential — a wrong path must not serve MCP.
check("wrong path is 404", (await fetch(`${BASE}/mcp`, { method: "POST" })).status === 404);

// Host-header allowlist should reject a rebinding-style Host. fetch() refuses
// to set Host (forbidden header name), so drive a raw socket instead.
const rawStatus = await new Promise((resolve, reject) => {
  const sock = net.connect(PORT, "127.0.0.1", () => {
    sock.write(
      `POST /mcp/${SECRET} HTTP/1.1\r\n` +
        `Host: evil.example.com\r\n` +
        `Content-Type: application/json\r\n` +
        `Content-Length: 2\r\n\r\n{}`
    );
  });
  let buf = "";
  sock.on("data", (d) => {
    buf += d;
    if (buf.includes("\r\n")) {
      sock.destroy();
      resolve(Number(buf.split(" ")[1]));
    }
  });
  sock.on("error", reject);
  setTimeout(() => (sock.destroy(), reject(new Error("timeout"))), 5000);
});
check("rejects disallowed Host header", rawStatus === 403, `got ${rawStatus}`);

// A POST without initialize must not silently open a session.
const noInit = await fetch(MCP_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
});
check("requires initialize before use", noInit.status === 400, `got ${noInit.status}`);

// Real client handshake.
const client = new Client({ name: "http-smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));

const { tools } = await client.listTools();
check("tools listed over HTTP", tools.length === 5, `${tools.length} tools`);
check(
  "search_flights present with slices",
  tools.find((t) => t.name === "search_flights")?.inputSchema?.properties?.slices?.type ===
    "array"
);

const ref = await client.callTool({ name: "routing_language_reference", arguments: {} });
check("tool call works over HTTP", /ROUTING CODES/.test(ref.content?.[0]?.text || ""));

const after = await (await fetch(`${BASE}/health`)).json();
check("session was registered", after.sessions >= 1, `${after.sessions} active`);

if (process.env.ITA_MATRIX_LIVE === "1") {
  console.log("\n--- live over HTTP ---");
  const d = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const r = await client.callTool({
    name: "search_flights",
    arguments: {
      slices: [{ origin: "JFK", destination: "LAX", date: d(60) }],
      limit: 2,
    },
  });
  const body = r.content?.[0]?.text || "";
  check("live search over HTTP", !r.isError && /#1/.test(body), body.split("\n")[0]);
  console.log(body.slice(0, 400));
}

await client.close();
child.kill("SIGTERM");
console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
