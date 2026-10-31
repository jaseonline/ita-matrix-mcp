/**
 * Resolve the public API key Matrix's web app uses.
 *
 * This is not a secret: matrix.itasoftware.com ships it in plaintext inside a
 * gstatic JS bundle that every visitor downloads. We still avoid pinning it as
 * the only source, because Google rotates these.
 *
 * Resolution order:
 *   1. a pinned key (ITA_MATRIX_API_KEY), if set
 *   2. the cache (30 day TTL). Trusted without a probe: if Google has
 *      rotated the key, the API rejects it and MatrixClient calls invalidate(),
 *      which clears the cache and re-resolves.
 *   3. known-good seeds, tried in order
 *   4. live discovery: homepage -> alkali bundle -> every AIza... candidate,
 *      each validated against a cheap endpoint
 *
 * The bundle contains ~7 AIza keys and only 2 are authorised for the Matrix
 * API, so "first regex match" is not good enough: candidates must be validated
 * before use.
 *
 * The cache is passed in, because it differs by runtime: a file on Node and KV
 * on Workers. It has read(), write(key) and clear(), which must not throw. With
 * no cache the key is simply held in memory.
 */

const KEY_RE = /AIza[0-9A-Za-z_-]{35}/g;
const HOME = "https://matrix.itasoftware.com/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

// Verified working as of the last protocol check. Used before falling back to
// a full bundle scrape, which costs a ~2 MB download.
const SEEDS = [
  "AIzaSyBH1mte6BdKzvf0c2mYprkyvfHCRWmfX7g",
  "AIzaSyA-9pyRbyL7NFyQLAFM7bjEXdUHEZv6RRo",
];

/** Pull every AIza-shaped candidate out of the homepage and its alkali bundle. */
async function discoverCandidates(fetchImpl) {
  const out = [];
  const res = await fetchImpl(HOME, { headers: { "User-Agent": UA } });
  const html = await res.text();
  out.push(...(html.match(KEY_RE) || []));

  // The key actually lives in the Alkali bundle referenced by the page.
  for (const m of html.matchAll(/src="(\/\/www\.gstatic\.com\/alkali\/[^"]+\.js)"/g)) {
    try {
      const bundle = await fetchImpl("https:" + m[1], { headers: { "User-Agent": UA } });
      out.push(...((await bundle.text()).match(KEY_RE) || []));
    } catch {
      /* try the next bundle */
    }
  }
  return [...new Set(out)];
}

export class KeyProvider {
  /**
   * @param {object} o
   * @param {{read: Function, write: Function, clear: Function}|null} [o.cache]
   * @param {string|null} [o.apiKey]  pinned key, skips all discovery
   * @param {(key: string) => Promise<boolean>} [o.validate]
   * @param {typeof fetch} o.fetchImpl  must already be bound (see MatrixClient)
   */
  constructor({ cache = null, apiKey = null, validate, fetchImpl }) {
    this._cache = cache;
    this._pinned = apiKey?.trim() || null;
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
    if (this._pinned) return; // a pinned key is the operator's call
    await this._cache?.clear();
  }

  async _resolve() {
    if (this._pinned) return (this._key = this._pinned);

    const cached = await this._cache?.read();
    if (cached) return (this._key = cached);

    for (const k of SEEDS) {
      if (await this._ok(k)) {
        await this._cache?.write(k);
        return (this._key = k);
      }
    }

    // Everything known is stale: scrape the live bundle.
    for (const k of await discoverCandidates(this._fetch)) {
      if (SEEDS.includes(k)) continue;
      if (await this._ok(k)) {
        await this._cache?.write(k);
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
