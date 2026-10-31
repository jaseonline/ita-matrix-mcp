# Security Policy

ita-matrix-mcp is a personal project maintained on a best-effort basis. Security reports are still taken seriously.

## Supported versions

Only the latest commit on `master` (currently version 1.0.0) receives fixes. There are no long-lived release branches,
so please reproduce an issue against current `master` before reporting it.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private reporting instead: open the repository's **Security** tab, choose **Report a vulnerability**, and
describe the issue. Helpful details include:

- what you found and which component it affects (stdio server, HTTP server, Cloudflare Worker, booking-link builders);
- steps or a proof of concept to reproduce it;
- the version or commit, and how the server was deployed (stdio, Docker, Cloudflare Workers).

You can expect an acknowledgement within about a week. After that I will confirm whether the report is accepted,
work on a fix, and tell you when it lands. If I decide the report is out of scope or not a vulnerability, I will explain
why. Credit in the changelog is available if you want it.

## Scope

In scope:

- The MCP server code under `src/` and the Cloudflare Worker under `cloudflare/`.
- The HTTP transport: the optional secret path (`ITA_MATRIX_SECRET_PATH`), the Host allowlist
  (`ITA_MATRIX_ALLOWED_HOSTS`), session handling and DNS-rebinding protection.
- Handling of tool input, including anything that could lead to unintended outbound requests or malformed
  booking links.
- Secrets, credentials or personal data committed to the repository.

Out of scope:

- ITA Matrix, Google, airline and booking sites themselves. Report issues in those to their owners.
- The upstream API key. The server discovers a key that Matrix's own web app ships to every visitor; it is public by
  design, not a leaked secret.
- Matrix rate limiting or blocking of your server's IP address.
- Findings that need an attacker to already control the machine, the environment variables or the deployment account.
- Denial of service through deliberately expensive searches on a server you chose to expose publicly without the
  hardening described below.

## Running it safely

- **Use HTTPS.** Remote connectors need a public HTTPS URL with a valid certificate.
- **Do not expose the HTTP server unprotected.** Set `ITA_MATRIX_SECRET_PATH` to a long random value (for example
  `openssl rand -hex 24`) so the URL acts as the credential, and set `ITA_MATRIX_ALLOWED_HOSTS` to your hostname.
- **Keep secrets out of git.** Copy `.env.example` to `.env`; `.env` is gitignored. Treat the secret-path URL like a
  password and rotate it if it leaks.
- **Understand what is stored.** Search results are cached in memory only, for 6 hours, under unguessable IDs. The one
  thing written to disk is the discovered (public) Matrix API key, cached for 30 days in
  `~/.cache/ita-matrix-mcp/api-key.json`; set `ITA_MATRIX_CACHE_DIR` to move it. There are no user accounts.
- **Expect to draw traffic.** A public instance sends its searches from your server's IP address to Google, whose rate
  limits are undocumented.
