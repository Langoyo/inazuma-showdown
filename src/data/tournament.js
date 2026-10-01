// Offline tournaments (knockouts and small leagues) played against the
// game's own real teams. Kept deliberately framework-agnostic — no DOM, no
// Phaser, no roster access — so it's easy to unit-test and easy to reason
// about: every function here takes plain data in and returns plain data
// out. GameScene owns turning an entrant id into an actual XI (via
// _fillSquadByPosition) and a "how strong is this team" number (via
// _playerRating) and passes those in as callbacks.
//
// An entrant id is either the literal string 'me' (the player's own
// current squad) or a team filter value in the same shape the squad
// editor's team dropdown already uses — 'TeamName' or 'TeamName::Game'
// (see _parseTeamFilter in GameScene.js) — identifying one of the game's
// real teams, one era at a time.
//
// Every match not involving 'me' is resolved instantly by a lightweight
// simulated scoreline (see simulateResult) instead of actually being
// played out on the pitch — otherwise a modest 8-team knockout would mean
// manually playing 7 full matches to see your own 3.

const TOURNAMENT_KEY = 'inazuma-clone:tournament:v1';

export function saveTournament(t) {
  try { localStorage.setItem(TOURNAMENT_KEY, JSON.stringify(t)); } catch { /* storage unavailable */ }
}
export function loadTournament() {
  try { return JSON.parse(localStorage.getItem(TOURNAMENT_KEY) || 'null'); } catch { return null; }
}
export function clearTournament() {
  try { localStorage.removeItem(TOURNAMENT_KEY); } catch { /* storage unavailable */ }
}

function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ════════════════════════════════════════════════════════════════════
// Knockout
// ════════════════════════════════════════════════════════════════════

function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function makeMatch(a, b) {
  // A bye (the field padded out to a power of two) auto-advances whoever's
  // actually there — nothing to play, nothing to simulate.
  if (a == null || b == null) {
    return { a, b, scoreA: null, scoreB: null, winner: a ?? b, bye: true };
  }
  return { a, b, scoreA: null, scoreB: null, winner: null, bye: false };
}

/** entrantIds: at least 2 entrant ids (see module doc), any count — padded
 *  with byes up to the next power of two, seeded in random order.
 *
 *  Byes are handed to the first `nulls` pairs, one per pair, rather than
 *  padded onto the end of a flat list and paired off sequentially — with
 *  entrantIds.length always more than half of `size` (that's what makes it
 *  the *next* power of two), `nulls` is always less than half the pairs,
 *  so every pair gets at most one bye. Padding onto the end instead can
 *  pair two byes together (5 entrants -> 8 slots -> 3 byes -> the last
 *  pair is bye-vs-bye), which has no winner and can never be resolved. */
export function makeKnockout(entrantIds, rng = Math.random) {
  const real = shuffle(entrantIds, rng);
  const size = nextPowerOfTwo(real.length);
  const nulls = size - real.length;
  const round0 = [];
  let ri = 0;
  for (let i = 0; i < size / 2; i++) {
    round0.push(i < nulls ? makeMatch(real[ri++], null) : makeMatch(real[ri++], real[ri++]));
  }
  return { type: 'knockout', entrants: entrantIds.slice(), rounds: [round0], createdAt: Date.now(), completedAt: null, champion: null };
}

/** The current round's still-open (non-bye, no winner yet) matches — the
 *  ones a caller still needs to resolve, one way or another. */
function openMatches(t) {
  const round = t.rounds[t.rounds.length - 1];
  return round.map((m, matchIdx) => ({ ...m, matchIdx })).filter((m) => !m.bye && m.winner == null);
}

function withRoundAdvanced(t) {
  const round = t.rounds[t.rounds.length - 1];
  if (round.some((m) => m.winner == null)) return t; // round not finished yet
  const winners = round.map((m) => m.winner);
  if (winners.length === 1) {
    return { ...t, completedAt: Date.now(), champion: winners[0] };
  }
  const nextRound = [];
  for (let i = 0; i < winners.length; i += 2) nextRound.push(makeMatch(winners[i], winners[i + 1]));
  return { ...t, rounds: [...t.rounds, nextRound] };
}

/** Records a played (or simulated) result for the current round's match at
 *  `matchIdx`, decides its winner, and advances to the next round once the
 *  whole round is resolved. A draw can't stand in a knockout — resolved by
 *  a coin flip, same as a shootout would in a full sim we're not running. */
export function recordKnockoutResult(t, matchIdx, scoreA, scoreB, rng = Math.random) {
  const rounds = t.rounds.map((r) => r.map((m) => ({ ...m })));
  const round = rounds[rounds.length - 1];
  const m = round[matchIdx];
  const winner = scoreA === scoreB ? (rng() < 0.5 ? m.a : m.b) : (scoreA > scoreB ? m.a : m.b);
  round[matchIdx] = { ...m, scoreA, scoreB, winner };
  return withRoundAdvanced({ ...t, rounds });
}

/** 1-based standard single-elimination seed order: seed 1 meets seed N
 *  (weakest) in round 1, and can only meet seed 2 (strongest of the rest)
 *  in the final if both keep winning — the classic bracket-seeding pattern
 *  ("1v8, 4v5, 2v7, 3v6" for size 8) that makes a favorable seed's path
 *  get harder round by round instead of being a flat coin flip. */
function seedPositions(size) {
  if (size === 1) return [1];
  const prev = seedPositions(size / 2);
  const out = [];
  for (const s of prev) { out.push(s); out.push(size + 1 - s); }
  return out;
}

/** Builds a knockout bracket from entrants already ordered by seed
 *  (entrantIdsBySeed[0] = seed 1, the favorable draw) instead of shuffling
 *  them — used for the player's tournaments so their opponents escalate in
 *  difficulty round by round. `entrantIdsBySeed.length` must already be a
 *  power of two (the UI only offers 4/8/16), so unlike makeKnockout this
 *  never needs bye-padding. */
export function makeSeededKnockout(entrantIdsBySeed) {
  const size = entrantIdsBySeed.length;
  const order = seedPositions(size);
  const round0 = [];
  for (let i = 0; i < size / 2; i++) {
    round0.push(makeMatch(entrantIdsBySeed[order[2 * i] - 1], entrantIdsBySeed[order[2 * i + 1] - 1]));
  }
  return { type: 'knockout', entrants: entrantIdsBySeed.slice(), rounds: [round0], createdAt: Date.now(), completedAt: null, champion: null };
}

// ════════════════════════════════════════════════════════════════════
// League (round-robin)
// ════════════════════════════════════════════════════════════════════

export function makeLeague(entrantIds, rng = Math.random) {
  const order = shuffle(entrantIds, rng);
  const fixtures = [];
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      fixtures.push({ a: order[i], b: order[j], scoreA: null, scoreB: null, played: false });
    }
  }
  return { type: 'league', entrants: entrantIds.slice(), fixtures, createdAt: Date.now(), completedAt: null };
}

export function recordLeagueResult(t, fixtureIdx, scoreA, scoreB) {
  const fixtures = t.fixtures.map((f) => ({ ...f }));
  fixtures[fixtureIdx] = { ...fixtures[fixtureIdx], scoreA, scoreB, played: true };
  const completedAt = fixtures.every((f) => f.played) ? Date.now() : null;
  return { ...t, fixtures, completedAt };
}

/** Standings table: points (win 3 / draw 1 / loss 0), then goal
 *  difference, then goals for, then insertion order — a stable, ordinary
 *  league table. */
export function leagueStandings(t) {
  const rows = new Map(t.entrants.map((id) => [id, { id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 }]));
  for (const f of t.fixtures) {
    if (!f.played) continue;
    const ra = rows.get(f.a), rb = rows.get(f.b);
    ra.played++; rb.played++;
    ra.gf += f.scoreA; ra.ga += f.scoreB;
    rb.gf += f.scoreB; rb.ga += f.scoreA;
    if (f.scoreA > f.scoreB) { ra.won++; ra.points += 3; rb.lost++; }
    else if (f.scoreA < f.scoreB) { rb.won++; rb.points += 3; ra.lost++; }
    else { ra.drawn++; rb.drawn++; ra.points++; rb.points++; }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, gd: r.gf - r.ga }))
    .sort((x, y) => y.points - x.points || y.gd - x.gd || y.gf - x.gf);
}

// ════════════════════════════════════════════════════════════════════
// Shared: instant simulation for matches that don't involve the player
// ════════════════════════════════════════════════════════════════════

function poissonSample(lambda, rng) {
  const limit = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > limit);
  return k - 1;
}

/** strengthA/strengthB: average player rating for each side (see
 *  _playerRating — centred around 100). Higher strength -> more expected
 *  goals, same shape as the confrontation odds elsewhere in the game. */
export function simulateResult(strengthA, strengthB, rng = Math.random) {
  const diff = strengthA - strengthB;
  // 0.05 a rating point at level-50 stats; ratings are 1.6× wider at level 99.
  const lambdaA = Math.min(4, Math.max(0.25, 1.3 + diff * 0.05 / 1.6));
  const lambdaB = Math.min(4, Math.max(0.25, 1.3 - diff * 0.05 / 1.6));
  return { scoreA: poissonSample(lambdaA, rng), scoreB: poissonSample(lambdaB, rng) };
}

/** Resolves every match/fixture not involving `me` (or whichever entrant
 *  id the caller passes as the "real" one) by simulating it, in place,
 *  until either a match involving that entrant is up next or the
 *  tournament is complete. `strengthOf(entrantId)` and `rng` are injected
 *  so this stays pure and testable. Returns the (possibly advanced)
 *  tournament plus whichever real-match is now pending, if any.
 *
 *  Resolves *every* match/fixture that doesn't involve `meId` before
 *  returning — not just whichever one happens to come first — so the
 *  bracket/table is always as complete as it can be around the one game
 *  still waiting on the player. Checking only the first open match would
 *  leave a sibling match unresolved whenever the player's own match
 *  happened to be seeded ahead of it. */
export function advanceAuto(t, meId, strengthOf, rng = Math.random) {
  let cur = t;
  for (;;) {
    if (cur.completedAt) return { tournament: cur, pending: null };
    if (cur.type === 'knockout') {
      const open = openMatches(cur);
      if (!open.length) { cur = withRoundAdvanced(cur); continue; }
      let pendingMatch = null;
      for (const m of open) {
        if (m.a === meId || m.b === meId) { pendingMatch = m; continue; }
        const { scoreA, scoreB } = simulateResult(strengthOf(m.a), strengthOf(m.b), rng);
        cur = recordKnockoutResult(cur, m.matchIdx, scoreA, scoreB, rng);
      }
      if (pendingMatch) return { tournament: cur, pending: { kind: 'knockout', matchIdx: pendingMatch.matchIdx, a: pendingMatch.a, b: pendingMatch.b } };
      // Every match in the round just got resolved (none involved meId) —
      // loop again to fold the now-complete round into the next one.
    } else {
      let pendingFixture = null;
      cur.fixtures.forEach((f, idx) => {
        if (f.played) return;
        if (f.a === meId || f.b === meId) { pendingFixture = pendingFixture ?? { idx, f }; return; }
        const { scoreA, scoreB } = simulateResult(strengthOf(f.a), strengthOf(f.b), rng);
        cur = recordLeagueResult(cur, idx, scoreA, scoreB);
      });
      if (pendingFixture) return { tournament: cur, pending: { kind: 'league', fixtureIdx: pendingFixture.idx, a: pendingFixture.f.a, b: pendingFixture.f.b } };
      return { tournament: { ...cur, completedAt: cur.completedAt ?? Date.now() }, pending: null };
    }
  }
}
