/**
 * Prompts and resources. Offline; no network access.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "../src/create-server.js";
import { ROUTING_REFERENCE } from "../src/routing-reference.js";

const client = new Client({ name: "guidance-test", version: "1.0.0" });
const promptText = async (name, args) =>
  (await client.getPrompt({ name, arguments: args })).messages[0].content.text;

before(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([createServer().connect(serverSide), client.connect(clientSide)]);
});

after(() => client.close());

test("the routing resource matches the routing tool", async () => {
  const { contents } = await client.readResource({ uri: "ita://reference/routing" });
  assert.equal(contents[0].text, ROUTING_REFERENCE);
});

test("the fare strategy resource does not sell salesCity as a price lever", async () => {
  const { contents } = await client.readResource({ uri: "ita://guides/fare-strategy" });
  assert.equal(contents[0].mimeType, "text/markdown");
  assert.match(contents[0].text, /salesCity is not a substitute/);
});

test("plan_trip includes the arguments it was given and omits the rest", async () => {
  const body = await promptText("plan_trip", { trip: "London to Tokyo in May", currency: "EUR" });
  assert.match(body, /Trip: London to Tokyo in May/);
  assert.match(body, /Currency: EUR/);
  assert.doesNotMatch(body, /Home airports|Cabin:|undefined/);
});

test("hunt_premium_fare defaults to business and to nearby hubs", async () => {
  const body = await promptText("hunt_premium_fare", { destination: "SYD", dates: "March 2027" });
  assert.match(body, /cheap BUSINESS fare to SYD, March 2027/);
  assert.match(body, /choose a few nearby major hubs/);
  assert.doesNotMatch(body, /undefined/);
});

test("explain_empty_search carries the failing search", async () => {
  const body = await promptText("explain_empty_search", { searchDescription: "AMS-SFO routing BA" });
  assert.match(body, /Search: AMS-SFO routing BA/);
});

test("a prompt missing its required argument is refused", async () => {
  await assert.rejects(client.getPrompt({ name: "plan_trip", arguments: {} }));
});
