# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

### Added

- `mcp.json` manifest describing the transports, environment variables and tools, with a test that keeps it in step
  with the tools the server actually registers.
- `.env.example` documenting every environment variable.
- `src/offline/`: a runnable stdio client and sample `search_flights` arguments.
- `CONTRIBUTING.md` and this changelog.
- MCP prompts (`plan_trip`, `hunt_premium_fare`, `explain_empty_search`) and resources (`ita://reference/routing`,
  `ita://guides/fare-strategy`) on both the Node server and the Cloudflare Worker.
- Claude Code setup: `CLAUDE.md`, a `/deploy-worker` skill for production Worker deploys, and project hooks that run
  the offline tests after `src/` edits and block edits to `.env`, `.dev.vars` and `package-lock.json`.
- Biome linting (`npm run lint`, also run in CI) with the recommended rule set; existing findings fixed (unused
  imports and variables, assignments in `return` expressions, comma operators).

### Changed

- `SECURITY.md` replaced the GitHub template with a real policy: supported versions, private reporting, scope and
  deployment hardening.
- The `salesCity` description no longer claims it finds cheaper pricing, and the Node routing reference now carries the
  same origin and premium-cabin notes as the Worker's.
- The Node server and the Worker now share one code base in `src/`, on MCP SDK v2. Only `src/node-runtime.js`,
  `src/server.js`, `src/http-server.js` and `cloudflare/src/` differ by runtime. Node Search IDs now take the Worker's
  `s-` plus 12 hex digits form, a cached API key is trusted until Matrix rejects it, and both servers report the same
  server metadata.
- The Worker's `wrangler` dev dependency moves to 4.158.0 (`workerd` 1.20261104.1, whose `allowScripts` entry follows).

### Fixed

- The Claude workflows (`claude_auto_review`, `claude_maintenance`) no longer fail at start-up: they stopped installing
  the `feature-dev@claude-plugins-official` plugin, which can no longer be installed.

### Removed

- The `claude-code-review` workflow. It duplicated `claude_auto_review` on every PR, and its `/code-review:code-review`
  prompt came from a plugin that is no longer in the marketplace.
- `get_itinerary_details` now gives each segment line its departure date and a day marker on the arrival time, and the
  agent brief marks arrival days too. Previously only the leg header showed `+N`, so dates after an overnight flight or
  layover had to be guessed. Arrivals on the previous calendar day now show `-1`.
- The `mcp-grade` workflow now runs on changes under `src/` and `cloudflare/src/`: its `paths: src` filter matched only a
  file literally named `src`.
- `cloudflare/README.md` no longer says `wrangler deploy` creates the KV namespace; `wrangler.jsonc` pins an existing one.

### Security

- The "Unknown Search ID" error no longer lists cached Search IDs, which let any client on a shared instance find and
  read another client's results.
- `ITA_MATRIX_SECRET_PATH` is trimmed without a backtracking regex (CodeQL `js/polynomial-redos`), and the `mcp-grade`
  workflow's token is limited to read access.
- `@hono/node-server` moves to 2.1.6 to clear GHSA-rmxm-3fg6-px4f (a second decode in `serveStatic` that could bypass
  middleware). The server never calls `serveStatic`, so it was not exploitable. To allow the update,
  `@modelcontextprotocol/node` moves to 2.1.2 and `@modelcontextprotocol/server`/`client` to 2.4.0 in both packages.
  The Worker's `agents` moves to 0.33.0, which declares 2.4.0 as its peer.

## [1.0.0]

### Added

- Five tools: `search_flights`, `get_itinerary_details`, `search_flexible_dates`, `lookup_airport` and
  `routing_language_reference`.
- Multi-city and open-jaw searches (1-6 legs) with per-leg ITA routing codes and extension codes.
- stdio and Streamable HTTP entrypoints, with optional secret path and Host allowlist for the HTTP server.
- Process-wide search cache (6-hour TTL) so `get_itinerary_details` survives session churn, with automatic re-run when
  Matrix's own pricing session expires.
- Booking hand-over links for British Airways, Iberia, American, Qantas and Emirates, plus Great Circle Mapper and
  Where to Credit.
- Cloudflare Worker deployment under `cloudflare/`.
