/**
 * Resolve the public API key Matrix's web app uses.
 *
 * This is not a secret: matrix.itasoftware.com ships it in plaintext inside a
 * gstatic JS bundle that every visitor downloads. We still avoid pinning it as
 * the only source, because Google rotates these.
 *
 * Resolution order:
 *   1. $ITA_MATRIX_API_KEY
 *   2. on-disk cache (30 day TTL)
 *   3. known-good seeds, tried in order
 *   4. live discovery: homepage -> alkali bundle -> every AIza... candidate,
 *      each validated against a cheap endpoint
 *
 * Note the bundle contains ~7 AIza keys and only 2 are authorized for the
 * Matrix API, so "first regex match" is not good enough — candidates must be
 * validated before use.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const KEY_RE = /AIza[0-9A-Za-z_-]{35}/g;
const TTL_MS = 30 * 24 * 3600 * 1000;
const HOME = "https://matrix.itasoftware.com/";

// Verified working as of the last protocol check. Used before falling back to
// a full bundle scrape, which costs a ~2 MB download.
const SEEDS = [
  "AIzaSyBH1mte6BdKzvf0c2mYprkyvfHCRWmfX7g",
  "AIzaSyA-9pyRbyL7NFyQLAFM7bjEXdUHEZv6RRo",
];

function cacheFile() {
  const base =
    process.env.ITA_MATRIX_CACHE_DIR ||
    path.join(homedir(), ".cache", "ita-matrix-mcp");
  return path.join(base, "api-key.json");
}

async function readCache() {
  try {
    const raw = JSON.parse(await readFile(cacheFile(), "utf8"));
    if (!raw?.key || typeof raw.key !== "string") return null;
    if (Date.now() - (raw.ts || 0) > TTL_MS) return null;
    return raw.key;
  } catch {
    return null;
  }
}

async function writeCache(key) {
  try {
    const f = cacheFile();
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, JSON.stringify({ key, ts: Date.now() }), "utf8");
  } catch {
    /* cache is an optimization; ignore failures */
  }
}

/** Pull every AIza-shaped candidate out of the homepage and its alkali bundle. */
async function discoverCandidates(fetchImpl = fetch) {
  const out = [];
  const res = await fetchImpl(HOME);
  const html = await res.text();
  out.push(...(html.match(KEY_RE) || []));

  // The key actually lives in the Alkali bundle referenced by the page.
  for (const m of html.matchAll(
    /src="(\/\/www\.gstatic\.com\/alkali\/[^"]+\.js)"/g
  )) {
    try {
      const bundle = await fetchImpl("https:" + m[1]);
      out.push(...((await bundle.text()).match(KEY_RE) || []));
    } catch {
      /* try the next bundle */
    }
  }
  return [...new Set(out)];
}

export class KeyProvider {
  constructor({ validate, fetchImpl = fetch } = {}) {
    this._validate = validate; // async (key) => boolean
    this._fetch = fetchImpl;
    this._key = null;
    this._inflight = null;
  }

  async get() {
    if (this._key) return this._key;
    // Collapse concurrent first-calls onto one resolution.
    this._inflight ??= this._resolve().finally(() => {
      this._inflight = null;
    });
    return this._inflight;
  }

  /** Called after the API rejects a key, so the next get() re-resolves. */
  async invalidate() {
    this._key = null;
    await writeCache("");
  }

  async _resolve() {
    const env = process.env.ITA_MATRIX_API_KEY?.trim();
    if (env) return (this._key = env);

    const cached = await readCache();
    const candidates = [
      ...(cached ? [cached] : []),
      ...SEEDS,
    ];

    for (const k of candidates) {
      if (await this._ok(k)) {
        await writeCache(k);
        return (this._key = k);
      }
    }

    // Everything known is stale — scrape the live bundle.
    for (const k of await discoverCandidates(this._fetch)) {
      if (candidates.includes(k)) continue;
      if (await this._ok(k)) {
        await writeCache(k);
        return (this._key = k);
      }
    }

    throw new Error(
      "Could not find a working ITA Matrix API key. Matrix may have changed " +
        "its web app. Set ITA_MATRIX_API_KEY to override."
    );
  }

  async _ok(key) {
    if (!this._validate) return true;
    try {
      return await this._validate(key);
    } catch {
      return false;
    }
  }
}
