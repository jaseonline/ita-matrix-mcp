/**
 * Keeps mcp.json honest: its tool list and version must match what the server
 * really registers and what package.json declares. Offline; no network access.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "../src/create-server.js";

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const manifest = readJson("../mcp.json");
const pkg = readJson("../package.json");

test("mcp.json tools match the tools the server registers", async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: "manifest-test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  const { tools } = await client.listTools();
  await client.close();

  const registered = tools.map((t) => t.name).sort();
  const declared = manifest.tools.map((t) => t.name).sort();
  assert.deepEqual(declared, registered);
});

test("mcp.json version matches package.json", () => {
  assert.equal(manifest.version, pkg.version);
});

test("mcp.json licence and description match package.json", () => {
  assert.equal(manifest.license, pkg.license);
  assert.equal(manifest.description, pkg.description);
});
