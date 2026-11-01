# Security Policy

ita-matrix-mcp is a personal project maintained on a best-effort basis. Security reports are still taken seriously.

## Supported Versions

| Version                 | Supported  |
| ----------------------- | ---------- |
| Latest commit on `main` | ✅ Current |

There are no tagged releases or long-lived release branches, so please reproduce an issue against current `main`
before reporting it.

## Reporting a Vulnerability

Please do **not** open public issues for security problems. Report privately instead:

- **GitHub Security Advisory**: https://github.com/jaseonline/ita-matrix-mcp/security/advisories/new

### What to include

- Vulnerability type and severity
- The component affected (stdio server, HTTP server, Cloudflare Worker, booking-link builders)
- Steps to reproduce
- Potential impact
- Proof of concept (if available)
- The commit, and how the server was deployed (stdio, Docker, Cloudflare Workers)

### What to expect

These are best-effort targets, not guarantees.

| Phase           | Target                                 |
| --------------- | -------------------------------------- |
| Acknowledgement | Within about a week                    |
| Disclosure      | Coordinated, aiming for within 90 days |

After acknowledging a report I will confirm whether it is accepted, work on a fix, and tell you when it lands. If I
decide it is out of scope or not a vulnerability, I will explain why. Credit in the changelog is available if you want
it.

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

## Security Practices

- Pull requests to `main` get an automated Copilot review. There is one maintainer, so changes do not get an independent
  human review, and some are pushed straight to `main`.
- Automated security scanning runs in CI.
- Dependabot alerts are enabled and handled on a best-effort basis, so an alert may stay open while a fix is assessed or
  waits on an upstream release.

---

_Maintained with [securitymd](https://github.com/LarsArtmann/securitymd). Last updated: 2026-11-01._
