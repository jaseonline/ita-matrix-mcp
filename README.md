# ITA Matrix MCP

An MCP server that searches [ITA Matrix](https://matrix.itasoftware.com) —
Google's fare engine, the one behind a lot of airline and OTA search — so Claude
can plan genuinely complex itineraries.

The point of using Matrix over an ordinary flight search is two things it has
that consumer sites don't: **arbitrary multi-city trips** and **ITA's routing
language**, which lets you constrain each leg by carrier, connection point,
alliance, or flight count.

Results are real, priced, availability-checked fares. They are not bookable
here — take the flight numbers to the airline or an OTA to ticket them.

## Tools

| Tool | What it does |
|---|---|
| `search_flights` | The workhorse. 1–6 legs: one-way, round-trip, multi-city, open-jaw. Per-leg routing codes. |
| `get_itinerary_details` | Expands one result into per-segment booking class (RBD), fare basis, and aircraft type. |
| `search_flexible_dates` | Scans a date range for the cheapest departure date. |
| `lookup_airport` | Resolves place names to IATA codes, including metro codes. |
| `routing_language_reference` | The routing-code cheat sheet, so Claude can compose non-trivial codes. |

### Multi-city

A trip is a list of legs, so every trip shape uses one tool:

```jsonc
{
  "slices": [
    { "origin": "JFK", "destination": "HND", "date": "2026-10-15" },
    { "origin": "HND", "destination": "SIN", "date": "2026-10-22" },
    { "origin": "SIN", "destination": "JFK", "date": "2026-10-30",
      "routing": "AA+ LHR AA+" }   // last leg: American, via Heathrow
  ],
  "cabin": "BUSINESS"
}
```

Legs need not connect — `JFK→LHR` then `CDG→JFK` is a valid open jaw.

### Routing codes

Per-leg, and the reason this beats normal search. `AA+` = only American,
`~ORD` = never via Chicago, `AA+ DFW AA+` = American connecting at Dallas,
`F F` = exactly two flights. Extension codes go in `extraCodes`:
`maxconnect 240`, `alliance star-alliance`, `-overnight`, `f bc=J|C`.

Call `routing_language_reference` for the full syntax.

> Note: `maxStops` is *relative to the route minimum*, matching Matrix's own
> semantics — `0` means "no more hops than strictly necessary", which on a
> long-haul may still involve a connection.

## Running it

Two entrypoints share one server definition:

```bash
npm install
node src/server.js        # stdio  — local Claude Code / Claude Desktop
node src/http-server.js   # HTTP   — remote, for Claude Desktop connectors
```

### Local (stdio)

```bash
claude mcp add ita-matrix -- node D:/path/to/ITA-Matrix-MCP/src/server.js
```

### Remote (Streamable HTTP)

Claude Desktop connects to remote servers **from Anthropic's cloud, not from
your machine**, so the server needs a public HTTPS URL with a valid
certificate. localhost and VPN-only hosts will not work. Remote servers are
added under **Settings → Connectors → Add custom connector**; they cannot be
configured through `claude_desktop_config.json`.

Deployed behind Coolify, the container speaks plain HTTP and Coolify's proxy
terminates TLS.

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Listen port. |
| `ITA_MATRIX_SECRET_PATH` | *(unset)* | Mounts MCP at `/mcp/<secret>` instead of `/mcp`. The URL then acts as the credential. |
| `ITA_MATRIX_ALLOWED_HOSTS` | *(unset)* | Comma-separated Host allowlist, guarding against DNS rebinding. |
| `ITA_MATRIX_API_KEY` | auto | Pin the upstream key instead of discovering it. |
| `ITA_MATRIX_TIMEOUT_MS` | `150000` | Upstream timeout. Multi-city searches are slow. |

`GET /health` returns status and active session count, for Coolify's health check.

Each HTTP session gets its own server instance and its own search cache, so
Search IDs never leak between clients. Idle sessions are swept after 30 minutes.

## How it works

Matrix is a Google "Alkali" app fronting the old QPX fare engine. Every call is
a single POST to `content-alkalimatrix-pa.googleapis.com/batch`, with the real
JSON-RPC request wrapped in a `multipart/mixed` envelope. Auth is the public API
key that the web app ships to every visitor — no cookies, no OAuth, no bot
token.

- `POST /v1/search` — run a fare search
- `POST /v1/summarize` — expand one solution (RBDs, aircraft), reusing the
  search's `session` + `solutionSet`, so detail lookups skip the engine re-run
- `GET /v1/locationTypes/...` — airport autocomplete

**Key discovery.** The key is not in the page HTML; it's in a gstatic Alkali
bundle, which contains about seven `AIza…` strings of which only two are
authorized for this API. So candidates are *validated* against a cheap endpoint
before use, then cached for 30 days, rather than taking the first regex match.
If Google rotates keys, the server re-discovers automatically.

**Quirks handled.** The engine refuses server-side price sorting on multi-slice
trips, so sorting is always done client-side. Premium economy is `PREMIUM-COACH`
on the wire while every other cabin uses the plain enum form. Matrix
intermittently returns "service is currently unavailable"; that is retried with
backoff.

## Testing

```bash
node test/smoke.mjs                          # offline: stdio, schemas, errors
node test/http-smoke.mjs                     # offline: HTTP session lifecycle
ITA_MATRIX_LIVE=1 node test/smoke.mjs        # live: real searches (slow)
ITA_MATRIX_LIVE=1 node test/http-smoke.mjs
```

Live tests hit the real service and take 20–60s per search.

## Caveats

- Not affiliated with Google, ITA Software, or ITA Matrix.
- Matrix's rate limits are undocumented. A publicly exposed instance draws that
  traffic to your server's IP.
- If Google starts requiring the `bgProgramResponse` (WAA) anti-bot token,
  this approach needs token handling added.
- Prior art: [`itamx`](https://github.com/yogevkr/itamx), a Python CLI/MCP for
  the same API, which is where the protocol details were confirmed.
