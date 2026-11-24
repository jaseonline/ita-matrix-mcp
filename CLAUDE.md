# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Two runtimes, one server
- `src/` is shared by the Node server and the Cloudflare Worker in `cloudflare/`. The Worker imports it through `../../src/...`.
- Only `src/server.js`, `src/http-server.js` and `src/node-runtime.js` may use Node APIs (`node:` imports, `process.*`, `require`). Everything else in `src/` must also run in the Worker.
  - `test/shared.test.mjs` (the `NODE_ONLY` list) enforces this, but only for top-level `src/*.js`. It misses dynamic `import("node:…")` and doesn't check `src/offline/`.
- `@modelcontextprotocol/server` must be the same exact version in `package.json` and `cloudflare/package.json`, and a test checks it. `wrangler.jsonc` aliases the SDK and zod to `cloudflare/node_modules`, so only one copy is bundled.
- In stdio mode, stdout is the MCP channel. Log to stderr only.
- Production is the Worker only. The Node and Docker server, including the files under `deploy/`, is for local dev and stdio. Deploy with `/deploy-worker`.

## Secret path
- MCP is served at `/mcp/<ITA_MATRIX_SECRET_PATH>`, and the URL is the credential.
- Without a secret, the Node server falls back to a public `/mcp`. The Worker fails closed and returns 503.
- Never print the secret or put it in a commit.
- The prod secret differs from the local `.env` and `.dev.vars` values. Using the local one against prod gives a 404.

## Tests
- `npm test` runs offline and quickly. Run it after any `src/` change.
- `npm run lint` runs `biome check`, which covers lint and formatting, and CI enforces it. Fix with `npx biome check --write`.
- `npm run test:live` uses POSIX inline env syntax, so run it from Bash, not PowerShell. Live tests make real Matrix searches and are fine to run, but never add them to CI.
- `node test/http-smoke.mjs` runs in CI but isn't part of `npm test`.
- Worker:
  - Start it with `cd cloudflare && npx wrangler dev --port 8799`, then run `node test/local.mjs`.
  - `LIVE=1` (not `ITA_MATRIX_LIVE`) adds real searches, which take about 3 minutes.
  - `BASE=<url> SECRET=<secret>` points the test at a deployed Worker.

## Keep in sync (CONTRIBUTING.md)
- Tool changes: update `mcp.json` and the README tool table. `test/manifest.test.mjs` checks that `mcp.json` matches the server and `package.json`.
- Env var changes: update `.env.example`, the README table and `mcp.json`.
- Prompts and resources live in `src/guidance.js` and must be listed in `mcp.json`.
- Every change needs a line under `[Unreleased]` in `CHANGELOG.md` (Keep a Changelog).

## Repo etiquette
- Changes normally go through a PR to `main` on branches named `fix/`, `chore/`, `feat/` or `refactor/`. Small docs or CI tweaks may go straight to `main`.
- Workflow actions are pinned to commit SHAs and run on `ubuntu-24.04`. Keep both when editing `.github/workflows/`.
- `src/handoff.js` is GPL-derived. Keep its licence header.
