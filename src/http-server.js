#!/usr/bin/env node
/**
 * Streamable HTTP entrypoint, for running behind Coolify (or any TLS proxy)
 * so Claude Desktop can reach it as a custom connector.
 *
 * Claude connects from Anthropic's cloud, not from the user's machine, so this
 * must be published on a public HTTPS URL. Coolify's proxy terminates TLS; this
 * process only ever speaks plain HTTP on PORT.
 *
 * Auth: Claude Desktop's connector UI has no field for custom headers, so a
 * bearer token cannot be supplied by the client. Instead the MCP endpoint can
 * be mounted at an unguessable path via ITA_MATRIX_SECRET_PATH — the secret
 * travels inside the HTTPS-encrypted request line, which is why the URL itself
 * must be treated as the credential. Without it the endpoint is public.
 *
 * No user data passes through this server: it proxies anonymous fare searches
 * and stores nothing but an in-memory cache of recent results.
 */

import http from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./create-server.js";

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// Mount path for the MCP endpoint. Set to something random to keep the server
// from being usable by anyone who merely learns the hostname.
const SECRET = (process.env.ITA_MATRIX_SECRET_PATH || "").replace(/^\/+|\/+$/g, "");
const MCP_PATH = SECRET ? `/mcp/${SECRET}` : "/mcp";

// Hosts allowed in the Host header, guarding against DNS-rebinding. Coolify
// sets the public domain; list it here (comma-separated) to enable the check.
const ALLOWED_HOSTS = (process.env.ITA_MATRIX_ALLOWED_HOSTS || "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const SESSION_IDLE_MS = 30 * 60 * 1000;

/** One MCP server + transport per session, so search IDs never cross clients. */
const sessions = new Map();

function log(...a) {
  process.stderr.write(`[ita-matrix] ${a.join(" ")}\n`);
}

function sweepSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastSeen > SESSION_IDLE_MS) {
      log("expiring idle session", id);
      s.transport.close().catch(() => {});
      sessions.delete(id);
    }
  }
}
setInterval(sweepSessions, 60_000).unref();

function send(res, code, payload, headers = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  res.writeHead(code, {
    "Content-Type":
      typeof payload === "string" ? "text/plain; charset=utf-8" : "application/json",
    ...headers,
  });
  res.end(body);
}

function rpcError(res, code, message, status = 400) {
  send(res, status, { jsonrpc: "2.0", error: { code, message }, id: null });
}

async function readBody(req, limitBytes = 4 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > limitBytes) throw new Error("Request body too large");
    chunks.push(c);
  }
  if (!total) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // Liveness probe for Coolify. Deliberately reveals nothing about the path.
  if (url.pathname === "/health") {
    return send(res, 200, { status: "ok", sessions: sessions.size });
  }

  if (ALLOWED_HOSTS.length) {
    const host = String(req.headers.host || "").split(":")[0].toLowerCase();
    if (!ALLOWED_HOSTS.includes(host)) {
      log("rejected Host header:", host);
      return send(res, 403, "Forbidden");
    }
  }

  if (url.pathname !== MCP_PATH) return send(res, 404, "Not found");

  // Browsers preflight before Claude's web client can POST.
  if (req.method === "OPTIONS") {
    return send(res, 204, "", {
      "Access-Control-Allow-Origin": req.headers.origin || "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, Last-Event-ID",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
      "Access-Control-Max-Age": "86400",
    });
  }
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  const sessionId = req.headers["mcp-session-id"];

  try {
    // Existing session: hand straight to its transport.
    if (sessionId && sessions.has(sessionId)) {
      const s = sessions.get(sessionId);
      s.lastSeen = Date.now();
      const body = req.method === "POST" ? await readBody(req) : undefined;
      return await s.transport.handleRequest(req, res, body);
    }

    if (sessionId) {
      return rpcError(res, -32001, "Unknown or expired session. Reconnect.", 404);
    }

    // No session yet — only an initialize POST may open one.
    if (req.method !== "POST") {
      return rpcError(res, -32000, "Expected POST to initialize a session.", 405);
    }

    const body = await readBody(req);
    const isInit =
      body &&
      (Array.isArray(body) ? body : [body]).some((m) => m?.method === "initialize");
    if (!isInit) {
      return rpcError(res, -32000, "Missing Mcp-Session-Id; send initialize first.", 400);
    }

    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, server, lastSeen: Date.now() });
        log("session opened", id, `(${sessions.size} active)`);
      },
    });

    await server.connect(transport);

    // Must be assigned AFTER connect(): the SDK's Protocol.connect() installs
    // its own transport.onclose, so anything set beforehand is overwritten.
    // It was, which is why closed sessions used to linger in the map until the
    // idle sweep collected them.
    const protocolOnClose = transport.onclose;
    transport.onclose = () => {
      protocolOnClose?.();
      if (transport.sessionId && sessions.delete(transport.sessionId)) {
        log("session closed", transport.sessionId, `(${sessions.size} active)`);
      }
    };

    await transport.handleRequest(req, res, body);
  } catch (err) {
    log("request failed:", err?.stack || err?.message || String(err));
    if (!res.headersSent) rpcError(res, -32603, "Internal server error", 500);
    else res.end();
  }
});

httpServer.listen(PORT, HOST, () => {
  log(`listening on ${HOST}:${PORT}`);
  log(`MCP endpoint: ${MCP_PATH}`);
  if (!SECRET) {
    log(
      "WARNING: ITA_MATRIX_SECRET_PATH is unset — the endpoint is reachable by " +
        "anyone who knows the hostname."
    );
  }
  if (!ALLOWED_HOSTS.length) {
    log("note: ITA_MATRIX_ALLOWED_HOSTS unset — Host header check disabled.");
  }
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    log(`${sig} received, shutting down`);
    for (const s of sessions.values()) s.transport.close().catch(() => {});
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
