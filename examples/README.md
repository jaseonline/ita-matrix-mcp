# Examples

| File | What it shows |
|---|---|
| [`stdio-client.mjs`](stdio-client.mjs) | A runnable MCP client. Offline by default (lists tools, prints the routing reference); pass `ORIGIN DEST YYYY-MM-DD` for a live one-way search. |
| [`multi-city.json`](multi-city.json) | `search_flights` arguments for a three-leg trip, with a per-leg routing code on the last leg. |
| [`open-jaw-star-alliance.json`](open-jaw-star-alliance.json) | An open-jaw trip using extension codes (`alliance`, `maxconnect`) and padded routing (`F? LHR F?`). |

The JSON files are the `arguments` object for the `search_flights` tool. Paste one into a Claude conversation
("search ITA Matrix with these arguments") or send it with any MCP client.

Run the client from the repository root:

```bash
npm install
node examples/stdio-client.mjs
```

Routing-code syntax is documented in the main [README](../README.md#routing-codes) and, in full, by the
`routing_language_reference` tool.
