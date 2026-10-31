/**
 * Worker entry point: ITA Matrix MCP over stateless Streamable HTTP.
 *
 * Auth: Claude's connector UI has no field for custom headers, so the MCP
 * endpoint is mounted at an unguessable path, /mcp/<ITA_MATRIX_SECRET_PATH>.
 * The secret travels inside the HTTPS request line, so the URL itself is the
 * credential: treat it like a password and keep it out of logs and screenshots.
 *
 * Unlike the Node server, this fails closed: with no secret configured the
 * Worker refuses to serve MCP at all, rather than exposing a public endpoint.
 *
 * No user data passes through: the Worker proxies anonymous fare searches and
 * stores only the discovered (public) API key and recent search results in KV.
 */

import { createMcpHandler } from "agents/mcp/server";
import { trimSlashes } from "../../src/secret-path.js";
import { createWorkerServer } from "./runtime.js";

const text = (body, status) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Liveness probe. Deliberately reveals nothing about the MCP path.
    if (url.pathname === "/health") return Response.json({ status: "ok" });

    const secret = trimSlashes(env.ITA_MATRIX_SECRET_PATH);
    if (!secret) {
      return text(
        "Not configured: set the ITA_MATRIX_SECRET_PATH secret (wrangler secret put ITA_MATRIX_SECRET_PATH).",
        503
      );
    }

    const route = `/mcp/${secret}`;
    if (url.pathname !== route) return text("Not found", 404);

    const options = { route };

    // workers.dev and localhost are allowed by default. A custom domain must be
    // listed here (comma-separated hostnames, no scheme or port).
    const hosts = String(env.ITA_MATRIX_ALLOWED_HOSTS || "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    if (hosts.length) options.allowedHostnames = hosts;

    return createMcpHandler(() => createWorkerServer(env, url.origin), options)(request, env, ctx);
  },
};
