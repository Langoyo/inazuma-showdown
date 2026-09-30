// One-shot clean-up of public/roster.json:
//  1. Entries for the same character in the same game, on the same team and
//     position, with the same stats, are merged into one: the lowest id is
//     kept, their techniques are pooled, and the dropped ids are recorded as
//     `aliases` on the survivor (getPlayerById resolves them, so saved squads
//     that point at a dropped copy still load). Same character on another
//     team, or in another position (Shawn Froste, IE2: DF and FW), is left
//     alone — those are separate cards on purpose.
//  2. A technique listed twice on one entry (e.g. God Hand twice), or listed
//     as an extra while already being that category's main one, is dropped.
//
//   node scripts/dedupe-roster.mjs [--write]
//
// Without --write it reports what it would do and changes nothing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROSTER = path.join(ROOT, 'public/roster.json');
const write = process.argv.includes('--write');

const roster = JSON.parse(fs.readFileSync(ROSTER, 'utf8'));
const idNum = (id) => Number(String(id).replace(/\D/g, '')) || 0;
const statKey = (p) => JSON.stringify(p.stats);
const CATS = ['shot', 'dribble', 'defense', 'keeper'];

/** Main technique per category, then every other one as an extra, with no
 *  (category, name) pair appearing twice. `sources` in priority order. */
function poolTechniques(sources) {
  const techniques = Object.fromEntries(CATS.map((c) => [c, null]));
  const seen = new Set();
  const extras = [];
  for (const p of sources) {
    for (const c of CATS) {
      const t = p.techniques?.[c];
      if (!t) continue;
      const key = `${c}:${t.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!techniques[c]) techniques[c] = t;
      else extras.push({ name: t.name, category: c, power: t.power, cost: t.cost });
    }
  }
  for (const p of sources) {
    for (const t of p.techniquesExtra || []) {
      const key = `${t.category}:${t.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      extras.push(t);
    }
  }
  return { techniques, techniquesExtra: extras };
}

// 1. Merge same-card duplicates.
const groups = new Map();
for (const p of roster) {
  const key = [p.name, p.game, p.team, p.position].join('|');
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(p);
}
const drop = new Set();
const merges = [];
const skipped = [];
for (const [key, ps] of groups) {
  if (ps.length < 2) continue;
  if (new Set(ps.map(statKey)).size > 1) { skipped.push(`${key}: stats differ, left alone`); continue; }
  const [keep, ...rest] = [...ps].sort((a, b) => idNum(a.id) - idNum(b.id));
  const before = poolTechniques([keep]).techniquesExtra.length + CATS.filter((c) => keep.techniques?.[c]).length;
  Object.assign(keep, poolTechniques([keep, ...rest]));
  const after = keep.techniquesExtra.length + CATS.filter((c) => keep.techniques[c]).length;
  keep.aliases = [...new Set([...(keep.aliases || []), ...rest.flatMap((r) => [r.id, ...(r.aliases || [])])])];
  rest.forEach((r) => drop.add(r));
  merges.push(`${keep.name} [${keep.game}, ${keep.team}]: kept ${keep.id}, merged ${rest.map((r) => r.id).join(', ')} (techniques ${before} -> ${after})`);
}

// 2. Repeated techniques within one entry.
const cleaned = [];
for (const p of roster) {
  if (drop.has(p)) continue;
  const count = (q) => (q.techniquesExtra || []).length + CATS.filter((c) => q.techniques?.[c]).length;
  const n = count(p);
  const pooled = poolTechniques([p]);
  if (pooled.techniquesExtra.length + CATS.filter((c) => pooled.techniques[c]).length !== n) {
    Object.assign(p, pooled);
    cleaned.push(`${p.name} [${p.game}] ${p.id}: ${n} -> ${count(p)} techniques`);
  }
}

const out = roster.filter((p) => !drop.has(p));
console.log(`merged groups   : ${merges.length} (${drop.size} entries removed)`);
merges.forEach((m) => console.log('  ' + m));
if (skipped.length) { console.log(`left alone      : ${skipped.length}`); skipped.forEach((s) => console.log('  ' + s)); }
console.log(`repeated techs  : ${cleaned.length} entries`);
cleaned.forEach((c) => console.log('  ' + c));
console.log(`roster          : ${roster.length} -> ${out.length}`);

if (!write) {
  console.log('\n(dry run — nothing written; pass --write to apply)');
  process.exit(0);
}
fs.writeFileSync(ROSTER, JSON.stringify(out));
console.log(`\nwrote ${ROSTER}`);
