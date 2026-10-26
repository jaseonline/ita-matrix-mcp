# ITA Matrix MCP on Cloudflare Workers

The same five tools as the Node server (`search_flights`, `get_itinerary_details`,
`search_flexible_dates`, `lookup_airport`, `routing_language_reference`), served
as a stateless Streamable HTTP MCP endpoint from a Worker, so Claude on the web
and mobile can use it without your PC being on.

`format.js`, `handoff.js`, `routing-reference.js` and `matrix-client.js` are the
repo's own modules (the client has two small changes, below). What is new:

| File | Role |
|---|---|
| `src/index.js` | Entry point. Mounts MCP at `/mcp/<secret>`; fails closed with no secret. |
| `src/create-server.js` | The repo's tool definitions, as a per-request factory using SDK v2 schemas. |
| `src/keys.js` | API-key discovery, cached in KV for 30 days instead of on disk. |
| `src/store.js` | Search results in KV for 6 hours (falls back to memory with no KV). |

Changes to `matrix-client.js`: it accepts `kv` / `apiKey`, and its default
`fetch` is wrapped, because calling a stored bare `fetch` as a method throws
"Illegal invocation" on Workers.

## Deploy

```powershell
cd D:\Projects\active\ita-matrix-mcp\cloudflare
npm install
npx wrangler login            # once
npx wrangler deploy           # creates the KV namespace; answers 503 until the secret is set

# Generate a long random path and store it as a secret (paste it when prompted):
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
npx wrangler secret put ITA_MATRIX_SECRET_PATH
```

Your connector URL is then
`https://ita-matrix-mcp.<your-workers-subdomain>.workers.dev/mcp/<secret>`.
Add it under Claude **Settings > Connectors > Add custom connector**. The URL is
the credential: keep it out of screenshots and logs. To rotate it, run
`wrangler secret put` again and update the connector.

## Test

```powershell
copy .dev.vars.example .dev.vars   # then edit the secret
npx wrangler dev --port 8799       # terminal 1
node test/local.mjs                # terminal 2: protocol checks, no upstream calls
$env:LIVE=1; node test/local.mjs   # real Matrix searches (about 3 minutes)
node --test test/handoff.test.mjs  # offline unit tests for the hand-over links
```

Against a deployed Worker: `BASE=https://... SECRET=... node test/local.mjs`.

## Configuration

| Name | Kind | Purpose |
|---|---|---|
| `ITA_MATRIX_SECRET_PATH` | secret | **Required.** Path segment after `/mcp/`. |
| `ITA_MATRIX_TIMEOUT_MS` | var | Upstream timeout per Matrix call (default 150000). |
| `ITA_MATRIX_ALLOWED_HOSTS` | var | Comma-separated hostnames; only needed behind a custom domain. |
| `ITA_MATRIX_API_KEY` | secret | Optional. Pin the upstream key instead of discovering it. |

## Things to know

- **Workers plan.** Searches are mostly waiting on Google, but each one also parses a large JSON
  response, and `search_flexible_dates` can do up to 21 in one request. The Free plan's 10 ms CPU
  limit per request is likely too tight; Workers Paid (30 s default CPU) is the safe choice.
- **Long calls.** Local runs of 53 s (one search) and 99 s (three-date scan) completed cleanly.
  Keep `maxDates` modest, and re-test any multi-city search from the real connector before relying on it.
- **Stateless by design.** There are no MCP sessions, so `GET` and `DELETE` on the endpoint return 405.
  Search IDs (`s-` plus 12 hex digits) live in KV, so they survive reconnects.
- **Unofficial API.** Not affiliated with Google. If Google starts requiring the `bgProgramResponse`
  anti-bot token, or blocks Cloudflare egress under heavier use, this approach needs revisiting.
- **Licence.** GPL-2.0-only, like the rest of the repo (`handoff.js` is a GPL-derived work).
