---
name: deploy-worker
description: Deploy main to the production Cloudflare Worker (ita-matrix-mcp) and prove it works - token pre-flight, wrangler deploy from cloudflare/, optional secret-path rotation, live check against prod, version ID confirmation. Pass "dry-run" to build and check without uploading anything.
disable-model-invocation: true
---

# Deploy the ita-matrix-mcp Worker

Mode: if `$ARGUMENTS` contains `dry-run`, run every read-only step, replace the
upload with `npx wrangler deploy --dry-run --outdir <scratchpad>/worker-dist`, and
skip anything that writes to Cloudflare (`deploy`, `secret put`, `rollback`).
Report what a real run would have done. Otherwise this is a real prod deploy.

This runbook exists because the last deploy went wrong twice: a Global API Key
was still in the shell, and the live check used a secret path that didn't
match prod. Steps 1 and 4 are there to catch exactly those.

Run every command from the repo root unless it says `cloudflare/`. Never print
a token or the secret path: check lengths and shapes, pass values through
environment variables or stdin, and redact them in anything you report.

## 1. Pre-flight (stop on any failure)

- **Branch state:** `git status --porcelain` is empty, the branch is `main`, and
  `git rev-list --count HEAD..origin/main` is 0 after `git fetch origin`.
  Deploying anything other than a clean, current `main` puts unreviewed code in prod.
- **CI:** `gh run list --branch main --limit 5` shows the latest `test` run for
  HEAD as success. If it's still running, wait. Don't deploy over red.
- **Offline tests:** `npm test` at the root passes. `shared.test.mjs` is the
  guard that the shared `src/` code still runs in the Worker.
- **Worker deps:** in `cloudflare/`, `npm ci` succeeds. `wrangler.jsonc` aliases
  the SDK and zod to `cloudflare/node_modules`, so a stale install bundles the
  wrong versions.
- **Token (the trap from last time):** Wrangler must use a scoped API token, not
  the Global API Key. Run this in PowerShell, which prints shapes only:

  ```powershell
  $p = $env:CLOUDFLARE_API_TOKEN; $u = [Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN','User')
  "process len=$($p.Length) globalShape=$($p -match '^[0-9a-f]{37}$')"
  "user    len=$($u.Length) globalShape=$($u -match '^[0-9a-f]{37}$') sameAsProcess=$($p -eq $u)"
  "legacyVarsSet=$([bool]($env:CLOUDFLARE_API_KEY -or $env:CLOUDFLARE_EMAIL))"
  ```

  - A value that is 37 lowercase hex characters is a Global API Key. Stop and say so.
  - If the process value differs from the User-scope value, this shell started
    before the token was changed. Windows doesn't refresh environment variables
    in shells that are already running. Use the User-scope value for this run by
    prefixing every wrangler call in the same PowerShell command:
    `$env:CLOUDFLARE_API_TOKEN = [Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN','User'); npx wrangler ...`.
    Remove `CLOUDFLARE_API_KEY` and `CLOUDFLARE_EMAIL` from the process the same way.
  - Confirm with `npx wrangler whoami` from `cloudflare/`. It should report an
    API Token and the expected account.

Summarise the pre-flight in a few lines: commit SHA and subject, CI status, test
result, token shape. Then ask the user to confirm the real deploy. Skip that
question in dry-run mode.

## 2. Deploy

From `cloudflare/`: `npx wrangler deploy`, or `--dry-run` in dry-run mode.
Capture these from the output: the `*.workers.dev` URL, the **Current Version
ID**, and the bindings list, which must include `ITA_KV`. A missing `ITA_KV`
means the config changed; stop and investigate before testing.

## 3. Secret path (only when it's changing)

The prod MCP endpoint is `/mcp/<ITA_MATRIX_SECRET_PATH>`. The path is the
credential, so rotating it locks out every client still using the old one.
Only rotate when the user asks to. Before writing, confirm that they know
clients must be updated.

Keep the value out of the transcript. Load it from `.env.prod` at the repo
root, which `.env.*` in `.gitignore` already covers, and pipe it via stdin:

```bash
set -a; . ./.env.prod; set +a
printf '%s' "$ITA_MATRIX_PROD_SECRET" | (cd cloudflare && npx wrangler secret put ITA_MATRIX_SECRET_PATH)
```

If `.env.prod` doesn't exist, ask the user to create it with
`ITA_MATRIX_PROD_SECRET=<value>`, or to generate one with
`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` in
their own terminal. Don't generate it here; that would print it.

## 4. Live check against prod

The live check needs prod's secret path, not the local one. The local `.env`
or `.dev.vars` value differing from prod is what made every MCP path 404 last
time. Use `ITA_MATRIX_PROD_SECRET` from `.env.prod`, as in step 3.

```bash
set -a; . ./.env.prod; set +a
cd cloudflare && BASE="<workers.dev URL>" SECRET="$ITA_MATRIX_PROD_SECRET" LIVE=1 node test/local.mjs
```

This takes about 3 minutes, because the Matrix searches are real. A pass
needs 0 `FAIL` lines and the final line `all checks passed`. Report the
`PASS` count; it was 20 last time, so a different count means the test
changed and is worth mentioning.

- **404 on `/mcp/<secret>` but `/health` is OK** means the secret doesn't
  match prod. Don't rotate on your own initiative. Ask the user which value is
  correct: fix `.env.prod`, or rotate per step 3.
- **Other failures:** show the FAIL lines. Offer
  `npx wrangler rollback <previous-version-id>` from `cloudflare/` and wait for
  a yes before running it, because it changes prod.

In dry-run mode, skip this step and say which URL and command a real run would use.

## 5. Confirm and report

Run `npx wrangler deployments list` from `cloudflare/`. The newest entry must
be the version ID captured in step 2. Finish with:

- The deployed commit (SHA and subject) and the version ID.
- Live check: N PASS, 0 FAIL, or what failed.
- Whether the secret path changed, and if so that clients need the new URL.
- Anything outstanding, such as a token that still needs rolling or a shell
  that should be restarted.
