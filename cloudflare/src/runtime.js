/**
 * Worker wiring for the shared server in ../../src: bindings instead of
 * environment variables, and KV for the API key and recent searches.
 *
 * Runs once per request (the stateless handler takes a factory), so all state
 * that must outlive a request lives in KV, not in module or closure variables.
 * KV is optional; without a binding the key is held for the life of the
 * isolate, and searches stay in that isolate's memory.
 */

import { createServer } from "../../src/create-server.js";
import { MatrixClient } from "../../src/matrix-client.js";
import { SearchStore } from "../../src/store.js";

const CACHE_KEY = "apikey";
const KEY_TTL_SECONDS = 30 * 24 * 3600;

/** The KeyProvider cache interface, backed by KV. */
const kvKeyCache = (kv) => ({
  async read() {
    try {
      const k = await kv?.get(CACHE_KEY);
      return typeof k === "string" && k ? k : null;
    } catch {
      return null;
    }
  },
  async write(key) {
    try {
      await kv?.put(CACHE_KEY, key, { expirationTtl: KEY_TTL_SECONDS });
    } catch {
      /* cache is an optimisation */
    }
  },
  async clear() {
    try {
      await kv?.delete(CACHE_KEY);
    } catch {
      /* cache is an optimisation */
    }
  },
});

/**
 * @param {object} env  Worker bindings and variables
 * @param {string} origin  public origin, for the server icon URL
 */
export function createWorkerServer(env = {}, origin = "") {
  const kv = env.ITA_KV ?? null;
  return createServer({
    client: new MatrixClient({
      timeoutMs: Number(env.ITA_MATRIX_TIMEOUT_MS) || 150000,
      keyCache: kvKeyCache(kv),
      apiKey: env.ITA_MATRIX_API_KEY ?? null,
    }),
    store: new SearchStore(kv),
    icons: origin
      ? [{ src: `${origin}/icon.png`, mimeType: "image/png", sizes: ["512x512"] }]
      : undefined,
  });
}
