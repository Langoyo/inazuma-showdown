import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, waitForRosterAtModeSelect } from './helpers.js';

/** Tournament is its own mode from the home screen now (not a button tucked
 *  inside the squad editor): pick type/size on the setup form *first*, hit
 *  Continue, then the squad editor opens for you to build your XI — the
 *  tournament itself only starts once that squad is confirmed. This drives
 *  exactly that sequence, leaving the caller in the squad editor ready to
 *  build a squad and click #confirm-squad-btn. */
async function openTournamentSetup(page, { type = 'knockout', size = '4' } = {}) {
  await waitForRosterAtModeSelect(page);
  await page.click('#mode-tournament-btn');
  if (type !== 'knockout') await page.check(`input[name="tournament-type"][value="${type}"]`);
  await page.check(`input[name="tournament-size"][value="${size}"]`);
  await page.click('[data-tournament-action="setup-continue"]');
}

// Coverage for offline tournaments (src/data/tournament.js + the
// GameScene wiring around it): the pure bracket/league engine on its own,
// then the actual UI flow — entrant picker, auto-resolving matches that
// don't involve the player, playing your own fixture through the ordinary
// match flow, and the result surviving the page reload _returnToMenu does
// after every match (tournament state lives only in localStorage for
// exactly that reason).

test.describe('pure tournament logic', () => {
  test('a knockout with a non-power-of-two entrant count pads with byes and always completes', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const mod = await import('/src/data/tournament.js');
      const outcomes = [];
      for (const n of [2, 3, 5, 6, 7, 9]) {
        const entrants = Array.from({ length: n }, (_, i) => `T${i}`);
        let t = mod.makeKnockout(entrants);
        const strengthOf = () => 100;
        // No entrant here is 'me', so advanceAuto should simulate the
        // whole thing through to a champion without ever returning pending.
        const res = mod.advanceAuto(t, 'me', strengthOf);
        outcomes.push({ n, completed: !!res.tournament.completedAt, pending: res.pending, champion: res.tournament.champion, isEntrant: entrants.includes(res.tournament.champion) });
      }
      return outcomes;
    });
    for (const o of result) {
      expect(o.completed, `n=${o.n}`).toBe(true);
      expect(o.pending, `n=${o.n}`).toBeNull();
      expect(o.isEntrant, `n=${o.n} champion should be one of the entrants`).toBe(true);
    }
  });

  test('league standings are computed correctly from recorded results', async ({ page }) => {
    await page.goto('/');
    const standings = await page.evaluate(async () => {
      const mod = await import('/src/data/tournament.js');
      let t = mod.makeLeague(['me', 'A', 'B']);
      // Force a known fixture order by finding each pair explicitly rather
      // than relying on the (shuffled) generated order.
      const idx = (a, b) => t.fixtures.findIndex((f) => (f.a === a && f.b === b) || (f.a === b && f.b === a));
      const record = (a, b, sa, sb) => {
        const fi = idx(a, b);
        const f = t.fixtures[fi];
        t = mod.recordLeagueResult(t, fi, f.a === a ? sa : sb, f.a === a ? sb : sa);
      };
      record('me', 'A', 2, 0); // me beats A
      record('me', 'B', 1, 1); // me draws B
      record('A', 'B', 3, 0); // A beats B
      return mod.leagueStandings(t);
    });
    const byId = Object.fromEntries(standings.map((r) => [r.id, r]));
    // me: W1 D1, 4 points, gd +2
    expect(byId.me.points).toBe(4);
    expect(byId.me.won).toBe(1);
    expect(byId.me.drawn).toBe(1);
    expect(byId.me.gd).toBe(2);
    // A: W1 L1, 3 points
    expect(byId.A.points).toBe(3);
    // B: L1 D1, 1 point
    expect(byId.B.points).toBe(1);
    // sorted by points desc: me (4), A (3), B (1)
    expect(standings.map((r) => r.id)).toEqual(['me', 'A', 'B']);
  });

  test('makeSeededKnockout gives the top seed the weakest opponent first, and only meets the runner-up seed in the final', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const mod = await import('/src/data/tournament.js');
      // entrantIdsBySeed[0] is the favorable draw (the player, in the real
      // game) — S1..S8 stand in for seed 1 (best) through seed 8 (weakest).
      const seeds = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
      const t = mod.makeSeededKnockout(seeds);
      const round0 = t.rounds[0];
      const myMatch = round0.find((m) => m.a === 'S1' || m.b === 'S1');
      const myOpponentR1 = myMatch.a === 'S1' ? myMatch.b : myMatch.a;
      // If S1 and S2 both win their side of the bracket, do they only meet
      // in the final (i.e. never share a round-0 pair)?
      const s2InMyRound0Pair = myMatch.a === 'S2' || myMatch.b === 'S2';
      return { myOpponentR1, s2InMyRound0Pair, roundCount: round0.length };
    });
    expect(result.myOpponentR1).toBe('S8'); // weakest seed
    expect(result.s2InMyRound0Pair).toBe(false);
    expect(result.roundCount).toBe(4);
  });

  test('simulateResult trends toward the stronger side on average', async ({ page }) => {
    await page.goto('/');
    const avg = await page.evaluate(async () => {
      const mod = await import('/src/data/tournament.js');
      let totalStrong = 0, totalWeak = 0;
      const N = 1500;
      for (let i = 0; i < N; i++) {
        const { scoreA, scoreB } = mod.simulateResult(112, 95);
        totalStrong += scoreA; totalWeak += scoreB;
      }
      return { strong: totalStrong / N, weak: totalWeak / N };
    });
    expect(avg.strong).toBeGreaterThan(avg.weak);
  });
});

test.describe('tournament UI', () => {
  test('the pool of possible opponents only includes teams that can actually field a full XI', async ({ page }) => {
    await waitForRosterLoaded(page);
    const check = await page.evaluate(() => {
      const s = window.__scene;
      const options = s._teamEraOptions();
      const tooSmall = options.filter((o) => s._entrantPool(o.value).length < 11);
      return { count: options.length, tooSmall: tooSmall.length };
    });
    expect(check.count).toBeGreaterThan(50);
    expect(check.tooSmall).toBe(0);
  });

  test('mode-select leads into the type/size setup form before the squad editor, unlike solo/multiplayer', async ({ page }) => {
    await waitForRosterAtModeSelect(page);
    await expect(page.locator('#mode-tournament-btn')).toHaveText('🏆 Tournament');
    await page.click('#mode-tournament-btn');
    await expect(page.locator('#tournament-panel')).toBeVisible();
    await expect(page.locator('#squad-editor-panel')).toBeHidden();
    await expect(page.locator('input[name="tournament-type"]')).toHaveCount(2);
    await expect(page.locator('input[name="tournament-size"]')).toHaveCount(3);
  });

  test('continuing from the setup form opens the squad editor with no rival tab, and it stays disabled until your squad is complete', async ({ page }) => {
    await openTournamentSetup(page, { size: '4' });
    await expect(page.locator('#tournament-panel')).toBeHidden();
    await expect(page.locator('#squad-editor-panel')).toBeVisible();
    await expect(page.locator('#squad-side-tabs')).toBeHidden();
    expect(await page.evaluate(() => window.__scene.uiMode)).toBe('tournament');
    // The AI difficulty is picked on the setup form and locked for the whole
    // tournament, so the editor doesn't offer it again; you're still the one
    // setting half length here (it's not a multiplayer-only row).
    await expect(page.locator('#ai-difficulty-row')).toBeHidden();
    await expect(page.locator('#half-length-row')).toBeVisible();

    await expect(page.locator('#confirm-squad-btn')).toBeDisabled();
    expect(await page.evaluate(() => window.__scene.activeTournament)).toBeNull();
  });

  test('picking a size draws exactly that many teams, and your squad locks in once confirmed', async ({ page }) => {
    await openTournamentSetup(page, { size: '8' });
    await page.click('#pitch-randomize-btn');
    const squadBefore = await page.evaluate(() => ({ starterIds: [...window.__scene.squadSlots], formation: window.__scene.chosenFormation }));
    await page.click('#confirm-squad-btn');

    const t = await page.evaluate(() => window.__scene.activeTournament);
    expect(t.entrants.length).toBe(8);
    expect(t.entrants[0]).toBe('me');
    expect(new Set(t.entrants).size).toBe(8); // no duplicate opponents
    expect(t.mySquad.starterIds).toEqual(squadBefore.starterIds);
    expect(t.mySquad.formation).toBe(squadBefore.formation);
    await expect(page.locator('#tournament-body')).toContainText('locked for this tournament');
  });

  test('a knockout draws opponents so your first-round rival is the weakest of the group, escalating from there', async ({ page }) => {
    await openTournamentSetup(page, { size: '8' });
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');

    const check = await page.evaluate(() => {
      const s = window.__scene;
      const t = s.activeTournament;
      const myMatch = t.rounds[0].find((m) => m.a === 'me' || m.b === 'me');
      const myOpponent = myMatch.a === 'me' ? myMatch.b : myMatch.a;
      const strengths = t.entrants.filter((id) => id !== 'me').map((id) => s._entrantStrength(id));
      return { myOpponentStrength: s._entrantStrength(myOpponent), weakestStrength: Math.min(...strengths) };
    });
    expect(check.myOpponentStrength).toBeCloseTo(check.weakestStrength, 5);
  });

  test('starting a knockout auto-resolves matches that do not involve you, leaving your own fixture up next', async ({ page }) => {
    await openTournamentSetup(page, { size: '4' });
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');

    const playBtn = page.locator('[data-tournament-action="play"]');
    await expect(playBtn).toBeVisible();
    expect(await playBtn.textContent()).toContain('You vs');

    // The other first-round match (the one without 'me') should already
    // carry a recorded score — it was simulated, not left pending.
    const otherMatchPlayed = await page.evaluate(() => {
      const t = window.__scene.activeTournament;
      const other = t.rounds[0].find((m) => m.a !== 'me' && m.b !== 'me');
      return other.scoreA != null && other.scoreB != null;
    });
    expect(otherMatchPlayed).toBe(true);
  });

  test('playing your fixture starts the match immediately with the locked squad and the opponent’s real roster — no Formation detour', async ({ page }) => {
    await openTournamentSetup(page, { size: '4' });
    await page.click('#pitch-randomize-btn');
    const lockedStarters = await page.evaluate(() => [...window.__scene.squadSlots]);
    await page.click('#confirm-squad-btn');
    await page.click('[data-tournament-action="play"]');

    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });
    const state = await page.evaluate(() => ({
      pending: window.__scene._tournamentPendingFixture,
      teamACount: window.__scene.teamA.length,
      teamBCount: window.__scene.teamB.length,
      teamAIds: window.__scene.teamA.map((e) => e.id),
    }));
    expect(state.pending).not.toBeNull();
    expect(state.teamACount).toBe(11);
    expect(state.teamBCount).toBe(11);
    expect(state.teamAIds).toEqual(lockedStarters);
    // The tournament panel should already be out of the way, not left
    // covering the match that just started.
    await expect(page.locator('#tournament-panel')).toBeHidden();
  });

  test('resuming an in-progress tournament goes straight to the bracket, never back through the squad editor', async ({ page }) => {
    await openTournamentSetup(page, { size: '8' }); // more rounds to reach
    await page.click('#pitch-randomize-btn');
    const lockedStarters = await page.evaluate(() => [...window.__scene.squadSlots]);
    await page.click('#confirm-squad-btn');
    await page.click('[data-tournament-action="play"]');
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });

    await page.evaluate(() => { document.querySelector('#scoreboard .score').textContent = '5-0'; });
    await page.evaluate(() => window.__scene._showFullTime());
    await page.waitForTimeout(150);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#squad-pick-list .pick-card').length > 0, { timeout: 15000 });
    await page.click('#landing-play-btn');

    // The button reflects that a tournament is already running, and jumps
    // straight to it — never back through the squad editor, so there's no
    // way to swap in a different XI mid-tournament.
    await expect(page.locator('#mode-tournament-btn')).toHaveText('🏆 Continue Tournament');
    await page.click('#mode-tournament-btn');
    await expect(page.locator('#squad-editor-panel')).toBeHidden();
    await expect(page.locator('[data-tournament-action="play"]')).toBeVisible();

    await page.click('[data-tournament-action="play"]');
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });
    const teamAIds = await page.evaluate(() => window.__scene.teamA.map((e) => e.id));
    expect(teamAIds).toEqual(lockedStarters);
  });

  test('the difficulty picked on the setup form applies to every match of the tournament, even across reloads', async ({ page }) => {
    await waitForRosterAtModeSelect(page);
    await page.click('#mode-tournament-btn');
    // Offered on the setup form, defaulting to Normal; the editor's own selector is gone in this mode.
    await expect(page.locator('#tournament-ai-level')).toHaveValue('normal');
    await page.selectOption('#tournament-ai-level', 'expert');
    await page.click('[data-tournament-action="setup-continue"]');
    await expect(page.locator('#ai-difficulty-row')).toBeHidden();
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');

    expect((await page.evaluate(() => window.__scene.activeTournament)).aiLevel).toBe('expert');
    await expect(page.locator('#tournament-body')).toContainText('Expert difficulty');

    await page.click('[data-tournament-action="play"]');
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });
    expect(await page.evaluate(() => window.__scene.aiLevel)).toBe('expert');
    expect(await page.evaluate(() => window.__scene._aiStatMul('B'))).toBeGreaterThan(1.25);
    await expect(page.locator('#mode-badge')).toHaveText('🏆 Tournament · Expert');

    // Full time reloads the page, which puts the level back to Normal — the
    // next fixture must still play at the tournament's own.
    await page.evaluate(() => { document.querySelector('#scoreboard .score').textContent = '5-0'; });
    await page.evaluate(() => window.__scene._showFullTime());
    await page.waitForTimeout(150);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#squad-pick-list .pick-card').length > 0, { timeout: 15000 });
    await page.click('#landing-play-btn');
    expect(await page.evaluate(() => window.__scene.aiLevel)).toBe('normal');
    await page.click('#mode-tournament-btn');
    await page.click('[data-tournament-action="play"]');
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });
    expect(await page.evaluate(() => window.__scene.aiLevel)).toBe('expert');
    await expect(page.locator('#mode-badge')).toHaveText('🏆 Tournament · Expert');
  });

  test('a tournament saved before difficulty was recorded plays on Normal', async ({ page }) => {
    await openTournamentSetup(page);
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    // An old save has no level; whatever the page was left on must not leak into it.
    await page.evaluate(() => { const s = window.__scene; const t = { ...s.activeTournament }; delete t.aiLevel; s.activeTournament = t; s._setAiLevel('expert'); });
    await page.click('[data-tournament-action="play"]');
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });
    expect(await page.evaluate(() => window.__scene.aiLevel)).toBe('normal');
  });

  test('the half length picked before the tournament sticks for every fixture, even across reloads', async ({ page }) => {
    await openTournamentSetup(page, { size: '8' });
    await page.selectOption('#half-length-select', '7');
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');

    expect((await page.evaluate(() => window.__scene.activeTournament)).halfLengthS).toBe(420);
    await expect(page.locator('#tournament-body')).toContainText('7 min halves');

    await page.click('[data-tournament-action="play"]');
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });
    expect(await page.evaluate(() => window.__scene.halfLengthS)).toBe(420);

    // Full time reloads the page, which resets the editor's select to its
    // default — the next fixture must still use the tournament's own value.
    await page.evaluate(() => { document.querySelector('#scoreboard .score').textContent = '5-0'; });
    await page.evaluate(() => window.__scene._showFullTime());
    await page.waitForTimeout(150);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#squad-pick-list .pick-card').length > 0, { timeout: 15000 });
    await page.click('#landing-play-btn');
    expect(await page.evaluate(() => window.__scene.halfLengthS)).not.toBe(420);
    await page.click('#mode-tournament-btn');
    await page.click('[data-tournament-action="play"]');
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });

    const clock = await page.evaluate(() => ({ half: window.__scene.halfLengthS, left: window.__scene.matchClock.secondsRemaining }));
    expect(clock.half).toBe(420);
    expect(clock.left).toBeGreaterThan(400);
  });

  test('the scoreboard names both sides: your team and the tournament opponent', async ({ page }) => {
    await openTournamentSetup(page, { size: '4' });
    await page.fill('#squad-team-name', 'Raimon FC');
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    const opponent = await page.evaluate(() => {
      const s = window.__scene;
      const m = s.activeTournament.rounds[0].find((x) => x.a === 'me' || x.b === 'me');
      return s._entrantLabel(m.a === 'me' ? m.b : m.a);
    });
    await page.click('[data-tournament-action="play"]');
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });
    await expect(page.locator('#score-name-a')).toHaveText('Raimon FC');
    await expect(page.locator('#score-name-b')).toHaveText(opponent);
  });

  test('finishing your match records the result, advances the bracket, and survives a reload', async ({ page }) => {
    await openTournamentSetup(page, { size: '4' });
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    await page.click('[data-tournament-action="play"]');
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });

    await page.evaluate(() => { document.querySelector('#scoreboard .score').textContent = '2-0'; });
    await page.evaluate(() => window.__scene._showFullTime());
    await page.waitForTimeout(150);

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('inazuma-clone:tournament:v1')));
    const myMatch = stored.rounds[0].find((m) => m.a === 'me' || m.b === 'me');
    expect(myMatch.winner).toBe('me');
    expect(myMatch.scoreA).not.toBeNull();
    expect(stored.mySquad).toBeTruthy();

    // A real reload is what actually happens after full time in the game
    // (_returnToMenu) — confirm the tournament isn't just in-memory state
    // that would vanish the moment that happens.
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#squad-pick-list .pick-card').length > 0, { timeout: 15000 });
    const afterReload = await page.evaluate(() => window.__scene.activeTournament);
    const myMatchAfter = afterReload.rounds[0].find((m) => m.a === 'me' || m.b === 'me');
    expect(myMatchAfter.winner).toBe('me');
    expect(afterReload.mySquad).toBeTruthy();
  });

  test('abandoning a tournament clears it and returns to the setup form', async ({ page }) => {
    await openTournamentSetup(page, { size: '4' });
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    await expect(page.locator('[data-tournament-action="end"]')).toBeVisible();

    await page.click('[data-tournament-action="end"]');
    await expect(page.locator('input[name="tournament-type"]')).toHaveCount(2);
    const stored = await page.evaluate(() => localStorage.getItem('inazuma-clone:tournament:v1'));
    expect(stored).toBeNull();
  });

  test('a league draws a standings table with a ranked row per entrant', async ({ page }) => {
    await openTournamentSetup(page, { type: 'league', size: '4' });
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');

    const table = page.locator('#tournament-body table.nes-table');
    await expect(table).toBeVisible();
    const rowCount = await table.locator('tbody tr').count();
    expect(rowCount).toBe(4); // me + 3 random opponents
    await expect(table).toContainText('You');
    // Ranked with a position column, not just a bare list.
    const firstCell = await table.locator('tbody tr').first().locator('td').first().textContent();
    expect(firstCell.trim()).toBe('1');
  });
});
