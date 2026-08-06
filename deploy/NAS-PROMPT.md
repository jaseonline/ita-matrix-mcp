# Deployment prompt for the NAS Claude

Copy everything in the block below and give it to the Claude instance on the
NAS that holds the Coolify and Cloudflare API tokens.

---

Deploy a public MCP server to my Coolify instance and give it a hostname via
Cloudflare. You have my Coolify API token and my Cloudflare API token.

**What it is:** an MCP (Model Context Protocol) server that searches ITA Matrix
for flights. Claude Desktop will connect to it as a remote custom connector, so
it must end up publicly reachable over HTTPS with a valid certificate — Claude
connects from Anthropic's cloud, not from my LAN, so LAN-only or Tailscale-only
will not work.

**Source:** https://github.com/Filip-Kin/ita-matrix-mcp (public, branch
`master`). It has a Dockerfile at the repo root — use that, not Nixpacks.

**Deployment steps:**

1. Create a Coolify Application resource from that public Git repo, branch
   `master`, build pack = Dockerfile.
2. Set the container port to **3000**. The app speaks plain HTTP; Coolify's
   proxy terminates TLS.
3. Set these environment variables:
   - `PORT=3000`
   - `HOST=0.0.0.0`
   - `NODE_ENV=production`
   - `ITA_MATRIX_ALLOWED_HOSTS=<the exact public domain you assign>`
   - `ITA_MATRIX_TIMEOUT_MS=150000`
   Leave `ITA_MATRIX_SECRET_PATH` unset — this endpoint is intentionally open,
   serving at `/mcp`.
4. Pick a subdomain on one of my existing Cloudflare zones (something like
   `matrix-mcp.<my-domain>`), create the DNS record pointing at the Coolify
   host, and set the same domain on the Coolify resource so it issues a
   Let's Encrypt certificate.
5. Health check path is `/health` on port 3000; it returns
   `{"status":"ok","sessions":N}`.
6. Deploy, and watch the build and container logs until it is running. On
   startup it logs `[ita-matrix] listening on 0.0.0.0:3000` and
   `[ita-matrix] MCP endpoint: /mcp`.

**Important — set the Cloudflare record to DNS-only (grey cloud), not proxied.**
Two reasons. First, a flight search can take 40–60 seconds and a complex
multi-city one can take longer, but Cloudflare's proxy times out an origin
response at ~100 seconds and returns a 524. Second, MCP replies stream over
Server-Sent Events, and Cloudflare's proxy can buffer them. DNS-only avoids
both. The trade-off is that it exposes the origin IP, which is acceptable here.
If you must proxy it, verify a real search completes end to end before calling
the deploy finished.

**Verify before reporting success.** Run all three against the real public
domain, not localhost:

```bash
# 1. Health
curl -s https://<domain>/health
# expect: {"status":"ok","sessions":0}

# 2. Valid TLS certificate
curl -sI https://<domain>/health | head -1
# expect: HTTP/2 200   (no cert warnings)

# 3. MCP handshake — this is the one that actually matters
curl -s -D- -X POST "https://<domain>/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1.0"}}}'
```

Check 3 must return `200`, a `content-type: text/event-stream`, an
`mcp-session-id` response header, and a body containing
`"serverInfo":{"name":"ita-matrix"`. If you get 404, the path or domain is
wrong. If you get 403, `ITA_MATRIX_ALLOWED_HOSTS` does not match the domain
you actually assigned — fix it to match exactly and redeploy.

**Report back:** the final connector URL in the form `https://<domain>/mcp`,
plus the output of all three checks.

---

## After the NAS finishes

Add it in Claude Desktop under **Settings → Connectors → Add custom connector**,
using the `https://<domain>/mcp` URL. Remote MCP servers cannot be configured
through `claude_desktop_config.json` — that file only handles local stdio
servers.

Then try something the ordinary flight search on a booking site cannot express,
for example: *"Find me business class New York → Tokyo → Singapore → New York
in October, and force the last leg onto American through Heathrow."*
