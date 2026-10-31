/**
 * Guards the code the Node server and the Worker share, and the two runtimes'
 * contract with it. Offline; no network access.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import { KeyProvider } from "../src/keys.js";
import { SearchStore } from "../src/store.js";

const NODE_ONLY = ["http-server.js", "node-runtime.js", "server.js"];
const srcDir = new URL("../src/", import.meta.url);
const shared = readdirSync(srcDir).filter((f) => f.endsWith(".js") && !NODE_ONLY.includes(f));

for (const file of shared) {
  test(`${file} is runtime-neutral`, () => {
    const body = readFileSync(new URL(file, srcDir), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(body, /from "node:|process\.(env|stderr|stdout)|require\(/);
  });
}

test("both package.json files pin the same MCP server SDK", () => {
  const dep = (rel) =>
    JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")).dependencies[
      "@modelcontextprotocol/server"
    ];
  assert.equal(dep("../package.json"), dep("../cloudflare/package.json"));
});

test("the memory store round-trips and rejects malformed IDs", async () => {
  const store = new SearchStore();
  const id = await store.remember({ ranked: [1] });
  assert.match(id, /^s-[0-9a-f]{12}$/);
  assert.deepEqual((await store.get(id)).ranked, [1]);
  assert.equal(await store.get("s-000000000000"), null);
  assert.equal(await store.get("../etc"), null);
});

test("the memory store drops the oldest entries past its cap", async () => {
  const store = new SearchStore();
  const first = await store.remember({ n: 0 });
  for (let n = 1; n <= 50; n++) await store.remember({ n });
  assert.equal(await store.get(first), null);
});

test("the memory store expires entries after 6 hours", async () => {
  const store = new SearchStore();
  const id = await store.remember({});
  const entry = await store.get(id);
  entry.createdAt = Date.now() - 6 * 60 * 60 * 1000 - 1;
  await store.update(id, entry);
  assert.equal(await store.get(id), null);
});

test("a KV-backed store keeps the original expiry on update", async () => {
  const puts = [];
  const store = new SearchStore({
    put: async (key, value, opts) => puts.push(opts.expirationTtl),
  });
  await store.update("s-000000000000", { createdAt: Date.now() - 3600 * 1000 });
  assert.ok(puts[0] <= 5 * 3600 && puts[0] > 5 * 3600 - 5);
});

const memoryCache = (key = null) => ({
  key,
  read: async function () {
    return this.key;
  },
  write: async function (k) {
    this.key = k;
  },
  clear: async function () {
    this.key = null;
  },
});

test("a pinned key is used without validation and survives invalidate", async () => {
  const cache = memoryCache("cached");
  const keys = new KeyProvider({ cache, apiKey: " pinned ", validate: async () => false });
  assert.equal(await keys.get(), "pinned");
  await keys.invalidate();
  assert.equal(cache.key, "cached");
});

test("a cached key is trusted without probing, and invalidate clears it", async () => {
  const cache = memoryCache("cached");
  let probes = 0;
  const keys = new KeyProvider({
    cache,
    validate: async () => {
      probes++;
      return true;
    },
  });
  assert.equal(await keys.get(), "cached");
  assert.equal(probes, 0);

  await keys.invalidate();
  assert.equal(cache.key, null);
  assert.notEqual(await keys.get(), "cached");
  assert.equal(probes, 1);
  assert.ok(cache.key, "the replacement key is written back");
});

test("a key provider works with no cache", async () => {
  const keys = new KeyProvider({ validate: async () => true });
  assert.ok(await keys.get());
});
