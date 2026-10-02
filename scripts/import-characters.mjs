// Rebuilds public/roster.json from the full character database
// (inazuma_characters.js: a minified ES module whose `c` export is every
// character, with teams, the seven native stats and full supertechnique
// lists).
//
// The file's own ids ("mark-evans-1") have nothing to do with ours
// ("vr-1"), so each current entry is matched to its new counterpart by
// name + game (then by name alone, for characters the file moved to
// another game) and keeps its id, aliases, pixel portrait and PT/stamina.
// That keeps saved squads, tournaments and stories pointing at the same
// players. Everything else — team, stats, element, techniques — comes from
// the new file, which is the source of truth.
//
// It mixes in the previous roster where the database is silent: a player the
// database calls Unaffiliated keeps the club the previous roster gave them,
// and a previous card with no counterpart in the database is kept as it was.
// The previous roster is read from git (the last commit before the first
// import), so re-running this always starts from the same two sources.
//
//   node scripts/import-characters.mjs <path-to-inazuma_characters.js> [--previous <roster.json>] [--write]
//
// Without --write it reports what it would do and changes nothing. With it,
// it writes public/roster.json, renames public/teams.json keys along team
// renames, and writes src/data/team-renames.json (old → new team names, so
// state saved before the import still finds its teams).

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROSTER = path.join(ROOT, 'public/roster.json');
const TEAMS = path.join(ROOT, 'public/teams.json');
const RENAMES = path.join(ROOT, 'src/data/team-renames.json');

const srcPath = process.argv[2];
const write = process.argv.includes('--write');
if (!srcPath) {
  console.error('usage: node scripts/import-characters.mjs <inazuma_characters.js> [--write]');
  process.exit(1);
}

// ---- load the module ---------------------------------------------------------
// It's ESM in a .js file; copied to a temp .mjs so Node imports it as such.
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inazuma-')), 'characters.mjs');
fs.copyFileSync(srcPath, tmp);
const mod = await import(pathToFileURL(tmp).href);
const chars = mod.c;
if (!Array.isArray(chars) || !chars.length) throw new Error('no characters found (expected an array as the `c` export)');

// The roster and kit colours as they were before the first import.
const PREVIOUS_COMMIT = '8626d06';
const prevArg = process.argv.indexOf('--previous');
const fromGit = (file) => JSON.parse(execSync(`git show ${PREVIOUS_COMMIT}:${file}`, { cwd: ROOT, maxBuffer: 64 << 20 }).toString());
const old = prevArg > 0 ? JSON.parse(fs.readFileSync(process.argv[prevArg + 1], 'utf8')) : fromGit('public/roster.json');
const teams = fromGit('public/teams.json');

// ---- mapping tables ----------------------------------------------------------
const GAME = { ie1: 'IE1', ie2: 'IE2', ie3: 'IE3', go1: 'GO1', go2: 'GO2', go3: 'GO3', ares: 'Ares', vr: 'VR' };
const ELEMENT = { fire: 'Fire', wood: 'Wood', wind: 'Air', earth: 'Earth' };
// Only these four have a confrontation category here; awakenings, keshin,
// mix-max, totems and modes are left out.
const CATEGORY = { SHOT: 'shot', DRIB: 'dribble', DEFF: 'defense', KEEP: 'keeper' };
const CATS = ['shot', 'dribble', 'defense', 'keeper'];
// Each technique's own element, which needn't be its user's (Axel's
// Inazuma Drop is Wind). Void is kept as a label but is neutral: no
// elemental edge either way (see ELEMENT_BEATS in GameScene).
const TECH_ELEMENT = { Fire: 'Fire', Wind: 'Air', Forest: 'Wood', Mountain: 'Earth', Void: 'Void' };
// The source's power tiers onto the game's own power/PT-cost scale — the
// exact pairs the previous import used for the same techniques.
const PW = [[30, 61, 10], [45, 71, 16], [50, 75, 18], [60, 82, 21], [70, 89, 24], [85, 99, 30], [100, 110, 35]];
function scale(pw) {
  if (!Number.isFinite(pw)) pw = 60;
  if (pw <= PW[0][0]) return { power: PW[0][1], cost: PW[0][2] };
  for (let i = 1; i < PW.length; i++) {
    const [p1, w1, c1] = PW[i - 1], [p2, w2, c2] = PW[i];
    if (pw <= p2) { const t = (pw - p1) / (p2 - p1); return { power: Math.round(w1 + t * (w2 - w1)), cost: Math.round(c1 + t * (c2 - c1)) }; }
  }
  const last = PW[PW.length - 1];
  return { power: last[1], cost: last[2] };
}

/** Strongest technique per category as the main one (earliest learned on a
 *  tie), every other one as an extra; a (category, name) pair only once. */
function techniquesOf(c) {
  const all = [];
  const seen = new Set();
  for (const h of c.hissatsusEn || []) {
    const category = CATEGORY[h.type];
    if (!category || !h.name) continue;
    const key = `${category}:${decode(h.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push({ name: decode(h.name), category, ...scale(h.pw), level: h.level ?? 99, el: TECH_ELEMENT[h.element] ?? null });
  }
  const techniques = Object.fromEntries(CATS.map((k) => [k, null]));
  for (const k of CATS) {
    const best = all.filter((t) => t.category === k).sort((a, b) => b.power - a.power || a.level - b.level)[0];
    if (best) techniques[k] = { name: best.name, cost: best.cost, power: best.power, ...(best.el ? { element: best.el } : {}) };
  }
  const techniquesExtra = all
    .filter((t) => techniques[t.category]?.name !== t.name)
    .sort((a, b) => a.level - b.level)
    .map(({ name, category, power, cost, el }) => ({ name, category, power, cost, ...(el ? { element: el } : {}) }));
  return { techniques, techniquesExtra };
}

// PT and stamina pools have no relation to the stats (correlation ~0 across
// the current roster), so a new character gets a stable value from its id,
// spread over the range the roster already uses.
const range = (k) => { const v = old.map((p) => p[k]).filter(Number.isFinite); return [Math.min(...v), Math.max(...v)]; };
const SP_RANGE = range('maxSP'), STA_RANGE = range('maxStamina');
function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const inRange = ([lo, hi], h) => lo + (h % (hi - lo + 1));

// A few names come HTML-escaped ("Go &amp; Shogi Club").
const decode = (v) => typeof v === 'string'
  ? v.replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  : v;

const LEVEL99 = 1.6;

// ---- build ---------------------------------------------------------------------
const techElementByName = new Map();
for (const c of chars) for (const h of c.hissatsusEn || []) {
  const el = TECH_ELEMENT[h.element];
  if (h.name && el && !techElementByName.has(decode(h.name))) techElementByName.set(decode(h.name), el);
}

const NOT_A_TEAM = new Set(['Unaffiliated', 'Sub Character', 'Unknown', '']);
const entries = chars.map((c) => ({
  src: c,
  game: GAME[c.game] || c.game,
  out: {
    id: c.id,
    name: decode(c.name),
    nickname: decode(c.nickname || c.name),
    position: c.position,
    ...(c.role && c.role !== 'player' ? { role: c.role } : {}),
    game: GAME[c.game] || c.game,
    // Level-99 numbers. The previous roster stored level 50, so matching
    // against it uses stats50 below.
    stats: { ...c.baseStats99 },
    ...techniquesOf(c),
    team: decode(c.team) || 'Unaffiliated',
    element: ELEMENT[c.element] || null,
  },
  stats50: { ...c.baseStats50 },
  claimed: null, // the current entry it took over from
}));

// ---- match current → new -------------------------------------------------------
const key = (name, game) => `${name.toLowerCase()}|${game}`;
const byKey = new Map(), byName = new Map();
for (const e of entries) {
  (byKey.get(key(e.out.name, e.game)) || byKey.set(key(e.out.name, e.game), []).get(key(e.out.name, e.game))).push(e);
  (byName.get(e.out.name.toLowerCase()) || byName.set(e.out.name.toLowerCase(), []).get(e.out.name.toLowerCase())).push(e);
}
const sameStats = (p, e) => Object.keys(p.stats || {}).every((k) => p.stats[k] === e.stats50[k]);
function pick(p, cands) {
  const free = cands.filter((e) => !e.claimed);
  return free.find((e) => e.out.position === p.position && sameStats(p, e))
    || free.find((e) => e.out.position === p.position && e.out.team === p.team)
    || free.find((e) => e.out.position === p.position)
    || free.find((e) => sameStats(p, e))
    || free[0] || null;
}
const matched = [], moved = [], kept = [];
for (const p of old) {
  const e = pick(p, byKey.get(key(p.name, p.game)) || []);
  if (e) { e.claimed = p; matched.push([p, e]); }
}
const matchedOld = new Set(matched.map(([p]) => p));
for (const p of old) {
  if (matchedOld.has(p)) continue;
  const e = pick(p, byName.get(p.name.toLowerCase()) || []);
  if (e) { e.claimed = p; matched.push([p, e]); matchedOld.add(p); moved.push(`${p.name}: ${p.game} → ${e.game}`); }
}
// Previous cards with no counterpart are kept as they were (their team is
// renamed below, with everyone else's).
for (const p of old) {
  if (matchedOld.has(p)) continue;
  const { aliases, ...card } = p;
  // The previous roster is level 50; the database's level 99 is 1.6× that
  // for every stat (1.58–1.64 after its rounding), so kept cards scale the same.
  card.stats = Object.fromEntries(Object.entries(card.stats).map(([k, v]) => [k, Math.round(v * LEVEL99)]));
  card.techniques = { shot: null, dribble: null, defense: null, keeper: null, ...(card.techniques || {}) };
  card.techniquesExtra = card.techniquesExtra || [];
  // Kept cards come from the previous roster, which had no technique
  // elements: take them from the same technique in the database by name.
  const withEl = (t) => (t && !t.element && techElementByName.get(t.name) ? { ...t, element: techElementByName.get(t.name) } : t);
  card.techniques = Object.fromEntries(Object.entries(card.techniques).map(([k, t]) => [k, withEl(t)]));
  card.techniquesExtra = card.techniquesExtra.map(withEl);
  entries.push({ src: null, game: p.game, out: { ...card, ...(aliases?.length ? { aliases } : {}) }, claimed: p, kept: true });
  kept.push(`${p.id} ${p.name} [${p.game}, ${p.team}]`);
}

for (const e of entries) {
  if (e.kept) continue;
  const p = e.claimed;
  if (p) {
    e.out.id = p.id;
    if (p.image) e.out.image = p.image;
    e.out.maxSP = p.maxSP; e.out.maxStamina = p.maxStamina;
  } else {
    e.out.maxSP = inRange(SP_RANGE, hash(e.out.id));
    e.out.maxStamina = inRange(STA_RANGE, hash(`${e.out.id}:stamina`));
  }
  if (!e.out.image && e.src?.imageUrl) e.out.image = e.src.imageUrl;
  const aliases = [...new Set([...(p?.aliases || []), ...(e.extraAliases || [])])].filter((a) => a !== e.out.id);
  if (aliases.length) e.out.aliases = aliases;
}

// ---- team renames (for kit colours and saved state) --------------------------
const newTeams = new Set(entries.filter((e) => !e.kept).map((e) => e.out.team));
const flows = new Map();
for (const [p, e] of matched) {
  if (NOT_A_TEAM.has(p.team)) continue;
  const f = flows.get(p.team) || flows.set(p.team, new Map()).get(p.team);
  f.set(e.out.team, (f.get(e.out.team) || 0) + 1);
}
const renames = {};
for (const [from, f] of flows) {
  if (newTeams.has(from)) continue; // still exists under its own name
  const total = [...f.values()].reduce((a, b) => a + b, 0);
  const [to, n] = [...f].sort((a, b) => b[1] - a[1])[0];
  if (!NOT_A_TEAM.has(to) && n / total >= 0.6) renames[from] = to;
}
// Where the database has no club for a player, the previous roster's (under
// its current name) fills in; kept cards get their team's current name.
const filled = new Map();
for (const e of entries) {
  const p = e.claimed;
  if (e.kept) { e.out.team = renames[e.out.team] || e.out.team; continue; }
  if (p && NOT_A_TEAM.has(e.out.team) && !NOT_A_TEAM.has(p.team)) {
    e.out.team = renames[p.team] || p.team;
    filled.set(`${e.out.team} (${e.out.game})`, (filled.get(`${e.out.team} (${e.out.game})`) || 0) + 1);
  }
}
// Other teams the database lists a character under ("Raimon, Inazuma
// National"): they count for those too, in filters, tournaments and stories.
let memberships = 0;
for (const e of entries) {
  if (!e.src?.teams) continue;
  const others = [...new Set(decode(e.src.teams).split(',').map((t) => t.trim()))]
    .filter((t) => t && t !== e.out.team && !NOT_A_TEAM.has(t));
  if (others.length) { e.out.otherTeams = others; memberships += others.length; }
}
const teamsOut = { ...teams };
for (const [from, to] of Object.entries(renames)) {
  if (teamsOut[from] && !teamsOut[to]) teamsOut[to] = teamsOut[from];
  delete teamsOut[from];
}
// Every card carries a team colour, as before: the team's Home kit; else the
// colour this team already had; else the one most of its players had under
// their old team (a renamed squad keeps its look); else one generated from
// the team's name.
const oldTeamColor = new Map(old.map((p) => [p.team, p.teamColor]));
const inherited = new Map();
for (const [p, e] of matched) {
  if (!p.teamColor) continue;
  const m = inherited.get(e.out.team) || inherited.set(e.out.team, new Map()).get(e.out.team);
  m.set(p.teamColor, (m.get(p.teamColor) || 0) + 1);
}
const hsl = (h, sat, l) => {
  const k = (n) => (n + h / 30) % 12, a = sat * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
};
function teamColorOf(team) {
  return teamsOut[team]?.kitColors?.Home
    || oldTeamColor.get(team)
    || [...(inherited.get(team) || [])].sort((a, b) => b[1] - a[1])[0]?.[0]
    || hsl(hash(team) % 360, 0.55, 0.55);
}
for (const e of entries) e.out.teamColor = teamColorOf(e.out.team);

// ---- dedupe (same rules as scripts/dedupe-roster.mjs) -------------------------
const groups = new Map();
for (const e of entries) {
  // Stats are part of the key: the file can list the same character twice
  // with different numbers (e.g. Fei Rune, GO2), and those stay two cards.
  const k = [e.out.name, e.out.game, e.out.team, e.out.position, JSON.stringify(e.out.stats)].join('|');
  (groups.get(k) || groups.set(k, []).get(k)).push(e);
}
const drop = new Set(), merges = [];
for (const [k, es] of groups) {
  if (es.length < 2) continue;
  // Keep a card that already had one of our ids, so saved squads stay put.
  const [keep, ...rest] = [...es].sort((a, b) => (!!b.claimed - !!a.claimed));
  const seen = new Set([...CATS.filter((c) => keep.out.techniques[c]).map((c) => `${c}:${keep.out.techniques[c].name}`), ...keep.out.techniquesExtra.map((t) => `${t.category}:${t.name}`)]);
  for (const r of rest) {
    for (const t of [...CATS.filter((c) => r.out.techniques[c]).map((c) => ({ ...r.out.techniques[c], category: c })), ...r.out.techniquesExtra]) {
      const tk = `${t.category}:${t.name}`;
      if (seen.has(tk)) continue;
      seen.add(tk);
      const el = t.element ? { element: t.element } : {};
      if (!keep.out.techniques[t.category]) keep.out.techniques[t.category] = { name: t.name, cost: t.cost, power: t.power, ...el };
      else keep.out.techniquesExtra.push({ name: t.name, category: t.category, power: t.power, cost: t.cost, ...el });
    }
    if (!keep.out.image && r.out.image) keep.out.image = r.out.image;
  }
  keep.out.aliases = [...new Set([...(keep.out.aliases || []), ...rest.flatMap((r) => [r.out.id, ...(r.out.aliases || [])])])].filter((a) => a !== keep.out.id);
  rest.forEach((r) => drop.add(r));
  merges.push(`${k.split('|{')[0]}: kept ${keep.out.id}, merged ${rest.map((r) => r.out.id).join(', ')}`);
}

const out = entries.filter((e) => !drop.has(e)).map((e) => e.out);
const ids = new Set();
for (const p of out) { if (ids.has(p.id)) throw new Error(`duplicate id ${p.id}`); ids.add(p.id); }

// ---- report ----------------------------------------------------------------------
const roles = out.reduce((m, p) => (m[p.role || 'player'] = (m[p.role || 'player'] || 0) + 1, m), {});
const viable = new Map();
for (const p of out) for (const t of [p.team, ...(p.otherTeams || [])]) if (!NOT_A_TEAM.has(t)) viable.set(`${t}|${p.game}`, (viable.get(`${t}|${p.game}`) || 0) + 1);
console.log(`source characters : ${chars.length}`);
console.log(`previous roster   : ${old.length}`);
console.log(`matched           : ${matched.length} (${moved.length} under another game)`);
console.log(`new characters    : ${entries.filter((e) => !e.claimed).length}`);
console.log(`kept from previous: ${kept.length} (no counterpart in the database)`);
console.log(`clubs filled in   : ${[...filled.values()].reduce((a, b) => a + b, 0)} (database says Unaffiliated)`);
console.log(`extra memberships : ${memberships}`);
console.log(`merged duplicates : ${merges.length} (${drop.size} removed)`);
console.log(`roster            : ${out.length} (${Object.entries(roles).map(([k, v]) => `${v} ${k}`).join(', ')})`);
console.log(`pixel portraits   : ${out.filter((p) => p.image?.startsWith('/')).length}, official art: ${out.filter((p) => p.image?.startsWith('http')).length}`);
console.log(`team renames      : ${Object.keys(renames).length}`);
Object.entries(renames).forEach(([a, b]) => console.log(`  ${a} → ${b}`));
console.log(`team-eras with 11 : ${[...viable.values()].filter((n) => n >= 11).length}`);
if (moved.length) { console.log('moved game:'); moved.forEach((m) => console.log('  ' + m)); }
if (kept.length) { console.log('kept from previous:'); kept.forEach((d) => console.log('  ' + d)); }
if (filled.size) { console.log('clubs filled in:'); [...filled].sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(`  ${t}: ${n}`)); }
if (merges.length) { console.log('merged:'); merges.forEach((m) => console.log('  ' + m)); }

if (!write) {
  console.log('\n(dry run — nothing written; pass --write to apply)');
  process.exit(0);
}
fs.writeFileSync(ROSTER, JSON.stringify(out));
fs.writeFileSync(TEAMS, JSON.stringify(teamsOut, null, 2) + '\n');
fs.writeFileSync(RENAMES, JSON.stringify(renames, null, 2) + '\n');
console.log(`\nwrote ${path.relative(ROOT, ROSTER)}, ${path.relative(ROOT, TEAMS)}, ${path.relative(ROOT, RENAMES)}`);
