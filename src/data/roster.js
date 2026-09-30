// The full roster (~9,500 players across IE1/IE2/IE3/GO1/GO2/GO3) is too
// big to bundle into the JS build, so it's served as a static asset
// (public/roster.json, ~3 MB) and fetched once at runtime instead of
// imported. Converted from a user-provided spreadsheet — see the README
// for exactly how each game's stats were normalized and what's missing
// (team names, and supertechniques for the GO-series players).
let cache = null;
let loadingPromise = null;

/** Fetches and caches the full roster. Safe to call more than once —
 * later calls reuse the same in-flight request or the cached result. */
export function loadRoster() {
  if (cache) return Promise.resolve(cache);
  if (loadingPromise) return loadingPromise;
  loadingPromise = fetch('/roster.json')
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load roster.json (HTTP ${res.status})`);
      return res.json();
    })
    .then((data) => {
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('roster.json loaded but is empty or not an array');
      }
      cache = data;
      return data;
    })
    .catch((err) => {
      loadingPromise = null; // allow retrying (e.g. after fixing the file) instead of caching the failure forever
      throw err;
    });
  return loadingPromise;
}

/** Only works after loadRoster() has resolved at least once. Also resolves
 * the ids of duplicate entries merged into another (their `aliases`, see
 * scripts/dedupe-roster.mjs), so an old saved squad still finds its player. */
export function getPlayerById(id) {
  if (!cache) return null;
  return cache.find((p) => p.id === id || p.aliases?.includes(id)) || null;
}

/** Distinct game tags present in the roster (IE1, IE2, IE3, GO1, GO2, GO3...),
 * in the order they first appear. Only works after loadRoster() resolves. */
export function getGames() {
  if (!cache) return [];
  const seen = [];
  for (const p of cache) if (!seen.includes(p.game)) seen.push(p.game);
  return seen;
}
