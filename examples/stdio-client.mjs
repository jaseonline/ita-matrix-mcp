/**
 * Minimal MCP client for ita-matrix-mcp over stdio.
 *
 * Usage (from the repository root, after `npm install`):
 *
 *   node examples/stdio-client.mjs                          # offline: list tools, print the routing reference
 *   node examples/stdio-client.mjs JFK LHR 2026-12-01       # live: one-way search, top 3 by price (20-60s)
 *
 * The offline mode needs no network access and is a quick way to confirm the server starts and registers its tools.
 */

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const [origin, destination, date] = process.argv.slice(2);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["src/server.js"],
});
const client = new Client({ name: "example-client", version: "1.0.0" });
await client.connect(transport);

try {
  const { tools } = await client.listTools();
  console.log("Tools:");
  for (const t of tools) console.log(`  ${t.name}  ${t.title ?? ""}`);

  const textOf = (result) => result.content.map((c) => c.text).join("\n");

  if (origin && destination && date) {
    console.log(`\nSearching ${origin} -> ${destination} on ${date} (this takes 20-60s)...\n`);
    const result = await client.callTool(
      {
        name: "search_flights",
        arguments: { slices: [{ origin, destination, date }], limit: 3 },
      },
      undefined,
      { timeout: 180_000 }
    );
    console.log(textOf(result));
    process.exitCode = result.isError ? 1 : 0;
  } else {
    const result = await client.callTool({ name: "routing_language_reference", arguments: {} });
    console.log("\nRouting language reference (first 15 lines):\n");
    console.log(textOf(result).split("\n").slice(0, 15).join("\n"));
  }
} finally {
  await client.close();
}
