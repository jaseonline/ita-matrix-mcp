/**
 * Recent-search store.
 *
 * Searches are expensive (20-60s), and detail lookups need the session and
 * solutionSet from the originating search, so recent searches are kept to make
 * get_itinerary_details a cheap follow-up instead of a full re-run.
 *
 * A Worker is stateless between requests (and each request may land in a
 * different isolate), so entries live in Workers KV with a 6 hour TTL. With no
 * KV binding the store falls back to a per-isolate Map, which keeps local
 * tests working but will lose entries whenever the isolate is recycled.
 *
 * IDs outlive any one connection, so they carry a random suffix: unguessable,
 * so one client cannot read another's results.
 */

const PREFIX = "search:";
const TTL_SECONDS = 6 * 60 * 60;

// Isolate-local fallback. Module scope on purpose.
const memory = new Map();

const hex = (bytes) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export class SearchStore {
  /** @param {KVNamespace|null} kv */
  constructor(kv) {
    this._kv = kv;
  }

  /** Save a search and return its ID. */
  async remember(entry) {
    const id = `s-${hex(6)}`;
    await this._put(id, { ...entry, createdAt: Date.now() });
    return id;
  }

  /** Fetch an entry, or null if unknown or expired. */
  async get(id) {
    if (typeof id !== "string" || !/^s-[0-9a-f]{12}$/.test(id)) return null;
    if (!this._kv) {
      const e = memory.get(id);
      if (!e) return null;
      if (Date.now() - e.createdAt > TTL_SECONDS * 1000) {
        memory.delete(id);
        return null;
      }
      return e;
    }
    return (await this._kv.get(PREFIX + id, "json")) ?? null;
  }

  /** Write an entry back (after a retry refreshed its pricing session). */
  async update(id, entry) {
    await this._put(id, entry);
  }

  /** A few known IDs, newest first where the backend allows, for error text. */
  async ids(limit = 10) {
    if (!this._kv) return [...memory.keys()].slice(-limit).reverse();
    const { keys } = await this._kv.list({ prefix: PREFIX, limit });
    return keys.map((k) => k.name.slice(PREFIX.length));
  }

  async _put(id, entry) {
    const age = Math.max(0, Math.floor((Date.now() - (entry.createdAt || Date.now())) / 1000));
    // KV needs a TTL of at least 60s; keep the original expiry on updates.
    const ttl = Math.max(60, TTL_SECONDS - age);
    if (!this._kv) {
      memory.set(id, entry);
      return;
    }
    await this._kv.put(PREFIX + id, JSON.stringify(entry), { expirationTtl: ttl });
  }
}
