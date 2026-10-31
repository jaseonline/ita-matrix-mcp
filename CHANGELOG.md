# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

### Added

- `mcp.json` manifest describing the transports, environment variables and tools, with a test that keeps it in step
  with the tools the server actually registers.
- `.env.example` documenting every environment variable.
- `examples/`: a runnable stdio client and sample `search_flights` arguments.
- `CONTRIBUTING.md` and this changelog.
- MCP prompts (`plan_trip`, `hunt_premium_fare`, `explain_empty_search`) and resources (`ita://reference/routing`,
  `ita://guides/fare-strategy`) on both the Node server and the Cloudflare Worker.
- `social-banner` workflow that renders the README banner to a 1280x640 PNG for use as the repository social preview.

### Changed

- `SECURITY.md` replaced the GitHub template with a real policy: supported versions, private reporting, scope and
  deployment hardening.
- The `salesCity` description no longer claims it finds cheaper pricing, and the Node routing reference now carries the
  same origin and premium-cabin notes as the Worker's.
- The Node server and the Worker now share one code base in `src/`, on MCP SDK v2. Only `src/node-runtime.js`,
  `src/server.js`, `src/http-server.js` and `cloudflare/src/` differ by runtime. Node Search IDs now take the Worker's
  `s-` plus 12 hex digits form, a cached API key is trusted until Matrix rejects it, and both servers report the same
  server metadata.

### Security

- The "Unknown Search ID" error no longer lists cached Search IDs, which let any client on a shared instance find and
  read another client's results.

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
