/**
 * Node wiring for the shared server: environment variables, an on-disk API key
 * cache, and one search store per process.
 *
 * The store is deliberately process-wide, NOT per-server. An HTTP MCP session
 * is far shorter-lived than the user's train of thought: it is swept after 30
 * minutes idle, and any reconnect (new conversation, dropped stream, client
 * restart) opens a fresh one. When the cache lived inside createServer(), every
 * one of those events silently emptied it, and get_itinerary_details answered
 * "Unknown Search ID" for an ID the model had just been handed.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { createServer } from "./create-server.js";
import { MatrixClient } from "./matrix-client.js";
import { SearchStore } from "./store.js";

const KEY_TTL_MS = 30 * 24 * 3600 * 1000;

function cacheFile() {
  const base =
    process.env.ITA_MATRIX_CACHE_DIR ||
    path.join(homedir(), ".cache", "ita-matrix-mcp");
  return path.join(base, "api-key.json");
}

async function writeKeyFile(key) {
  try {
    const f = cacheFile();
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, JSON.stringify({ key, ts: Date.now() }), "utf8");
  } catch {
    /* cache is an optimisation; ignore failures */
  }
}

/** The KeyProvider cache interface, backed by a file. */
export const fileKeyCache = {
  async read() {
    try {
      const raw = JSON.parse(await readFile(cacheFile(), "utf8"));
      if (!raw?.key || typeof raw.key !== "string") return null;
      if (Date.now() - (raw.ts || 0) > KEY_TTL_MS) return null;
      return raw.key;
    } catch {
      return null;
    }
  },
  write: writeKeyFile,
  clear: () => writeKeyFile(""),
};

const client = new MatrixClient({
  timeoutMs: Number(process.env.ITA_MATRIX_TIMEOUT_MS) || 150000,
  keyCache: fileKeyCache,
  apiKey: process.env.ITA_MATRIX_API_KEY ?? null,
});
const store = new SearchStore();

/** Called once per stdio process, and once per HTTP session. */
export const createNodeServer = () => createServer({ client, store });
