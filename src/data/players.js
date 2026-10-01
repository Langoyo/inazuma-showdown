// A player's in-match state: base stats + technique points (PT) — no
// cooldowns, and no regeneration either. A supertechnique can be used as
// many times as a player can afford from their starting PT; once they're
// out for a category, only the normal action is left for the rest of
// the match (subbing them off is the only way to get a fresh PT pool).
//
// PT and physical condition are now per-player stats too, sourced from the
// roster (each character's own level-99 TP and FP), instead of a flat 100 —
// see applyRosterPlayerToStats. A player with more PT can afford more
// supertechniques over a match; a player with more physical condition
// (stamina) stays fresh for longer before fatigue starts dragging on their
// speed (see FATIGUE_* in GameScene, which drains `stamina` over match time).
// The seven stats the games themselves show on a character's page, stored as
// the raw game numbers at level 99 (roughly 130-195) rather than anything of our own —
// so a stat sheet here reads the same as one there. We used to store five
// stats of our own invention derived from these, which matched nothing a
// player could look up and lost information on the way (two of the five
// averaged in `physical`, so the seven weren't recoverable from them).
export const NATIVE_STATS = ['kick', 'control', 'technique', 'pressure', 'physical', 'agility', 'intelligence'];

/** Raw game stat → the ~1.0 multiplier the physics code expects. Only the two
 *  places that need an absolute scale use it (movement pace and foul
 *  likelihood); confrontations compare one side's stat against the other's,
 *  which is a ratio and so doesn't care what units both sides are in. */
// 0.0105 at level 50; level-99 stats are 1.6× those, so pace and fouls stay put.
export const STAT_UNIT = 0.0105 / 1.6;
export const statMul = (v) => v * STAT_UNIT;

export function createPlayerStats(name = 'Player') {
  return {
    name,
    element: null, // Fire / Wood / Air / Earth — see ELEMENT_BEATS in GameScene
    // Roughly the roster's own median, so a statless placeholder plays as an
    // unremarkable player rather than a broken one.
    kick: 152,
    control: 152,
    technique: 152,
    pressure: 152,
    physical: 152,
    agility: 152,
    intelligence: 152,

    maxSP: 100,
    sp: 100,

    maxStamina: 150,
    stamina: 150,
    onPitchSince: 0, // match-clock timestamp this player last took the field — resets their fatigue

    techniques: { shot: null, dribble: null, defense: null, keeper: null },
    techniquesExtra: [] // any further techniques of a category that already has one active (see techniquesFor)
  };
}

export function applyRosterPlayerToStats(stats, rosterPlayer) {
  stats.name = rosterPlayer.nickname || rosterPlayer.name;
  stats.element = rosterPlayer.element || null;
  for (const k of NATIVE_STATS) stats[k] = rosterPlayer.stats[k];
  stats.techniques = rosterPlayer.techniques;
  stats.techniquesExtra = rosterPlayer.techniquesExtra || [];
  stats.maxSP = rosterPlayer.maxSP || 100;
  stats.sp = stats.maxSP;
  stats.maxStamina = rosterPlayer.maxStamina || 150;
  stats.stamina = stats.maxStamina;
  stats.onPitchSince = 0;
  return stats;
}

/** Every technique this player has for `category` — the one active in the
 * `techniques` slot plus any others of the same category that were sitting
 * unused in `techniquesExtra` (a player with, say, two shot techniques can
 * now pick either one in a confrontation instead of only ever the first). */
export function techniquesFor(stats, category) {
  const list = [];
  if (stats.techniques[category]) list.push(stats.techniques[category]);
  if (stats.techniquesExtra) {
    for (const t of stats.techniquesExtra) if (t.category === category) list.push(t);
  }
  return list;
}

/** Can this player afford at least one of their `category` supertechniques
 * right now? No cooldown — the only gate is whether PT covers its cost. */
export function canActivate(stats, category) {
  return techniquesFor(stats, category).some((t) => stats.sp >= t.cost);
}
