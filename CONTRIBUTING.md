# Contributing

Thanks for taking an interest. Issues and pull requests are welcome.

## Setup

Node.js 20 or later is required.

```bash
git clone https://github.com/jaseonline/ita-matrix-mcp.git
cd ita-matrix-mcp
npm install
npm test
```

`npm test` runs the unit tests and the offline stdio smoke test. Neither needs network access.

The live tests talk to the real ITA Matrix service, take 20-60 seconds per search, and should be run sparingly:

```bash
npm run test:live
```

Matrix's rate limits are undocumented, so please do not add live tests to CI.

## Making a change

1. Branch from `master`; it is protected, so changes go through a pull request.
2. Keep changes focused, and add or update a test where behaviour changes.
3. If you add, rename or remove a tool, update `mcp.json` and the tool table in `README.md`. `test/manifest.test.mjs`
   fails when `mcp.json` and the registered tools disagree.
4. If you change an environment variable, update `.env.example`, the table in `README.md` and `mcp.json`.
5. Prompts and resources live in `src/guidance.js`. Copy changes to `cloudflare/src/guidance.js`, and list new ones in
   `mcp.json`. `npm test` fails if the copies or the manifest disagree.
6. Add a line under `[Unreleased]` in `CHANGELOG.md`.

## Checks that run on pull requests

- **Lint Code Base**: super-linter over any changed GitHub Actions workflows.
- **mcp-grade**: static grading of the repository as an MCP server; the build fails below grade C.

## Security

Never commit secrets, `.env` files or API keys. Report vulnerabilities as described in [SECURITY.md](SECURITY.md)
rather than in a public issue.

## Licence

By contributing you agree that your contribution is licensed under GPL-2.0-only, the same as the project. See
[LICENSE](LICENSE).
