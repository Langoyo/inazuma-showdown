import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

// Duel cards wear the team colours, an offside freezes play and drops the
// attackers back behind the ball, duels cost stamina (running much less),
// and the Hard rival picks its shots instead of firing on sight.
// Pitch 960 x 1520: you (A) attack y=0, the AI (B) attacks y=1520.

async function match(page) {
  await waitForRosterLoaded(page);
  await startMatch(page);
  await page.evaluate(() => {
    const s = window.__scene;
    window.__put = (e, x, y) => { s.matter.body.setPosition(e.body, { x, y }); s.matter.body.setVelocity(e.body, { x: 0, y: 0 }); };
  });
}

test.describe('duel cards', () => {
  test('each card carries a band in its team\'s colour', async ({ page }) => {
    await match(page);
    const cols = await page.evaluate(() => {
      const s = window.__scene;
      const eA = s.teamA.find((e) => e.slot !== 0), eB = s.teamB.find((e) => e.slot !== 0);
      s.confrontation = { type: 'duel', attackerRole: 'A', defenderRole: 'B', attackerId: eA.id, defenderId: eB.id,
        deadline: s.time.now + 1, attackerChoice: 'normal', defenderChoice: 'normal', attackerLocked: true, pending: null };
      s._prepareConfrontReveal(s.time.now);
      s._renderDuelReveal({ ...s.confrontation.reveal, lit: true });
      const hex = (c) => '#' + c.toString(16).padStart(6, '0');
      const bg = (id) => getComputedStyle(document.querySelector(`#${id} .duel-team`)).backgroundColor;
      const rgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
      return { a: bg('duel-card-a'), d: bg('duel-card-d'), wantA: rgb(hex(s.teamColorA)), wantD: rgb(hex(s.teamColorB)) };
    });
    expect(cols.a).toBe(cols.wantA);
    expect(cols.d).toBe(cols.wantD);
    expect(cols.a).not.toBe(cols.d);
  });
});

test.describe('offside', () => {
  // The offside side goes back to its own half for the free kick; anyone
  // already there, and the keeper, stay put. A defends the bottom (attacks
  // y=0), B the top (attacks y=1520).
  for (const [role, ball, inRivalHalf, inOwnHalf] of [
    ['A', { x: 480, y: 600 }, [{ x: 300, y: 400 }, { x: 700, y: 700 }], [{ x: 520, y: 1100 }]],
    ['B', { x: 480, y: 920 }, [{ x: 300, y: 1120 }, { x: 700, y: 820 }], [{ x: 520, y: 420 }]],
  ]) {
    test(`play freezes for a beat and side ${role} drops back to its own half`, async ({ page }) => {
      await match(page);
      const r = await page.evaluate(([role, ball, rivalHalf, ownHalf]) => {
        const s = window.__scene;
        const team = role === 'A' ? s.teamA : s.teamB;
        const out = team.filter((e) => e.slot !== 0);
        const gk = team.find((e) => e.slot === 0);
        s.matter.body.setPosition(s.ball, ball);
        const movers = out.slice(0, rivalHalf.length), stayers = out.slice(rivalHalf.length, rivalHalf.length + ownHalf.length);
        movers.forEach((e, i) => window.__put(e, rivalHalf[i].x, rivalHalf[i].y));
        stayers.forEach((e, i) => window.__put(e, ownHalf[i].x, ownHalf[i].y));
        const gkBefore = { x: gk.body.position.x, y: gk.body.position.y };
        s._commitOffside(role, s.time.now);
        const half = s.FIELD_H / 2;
        return {
          paused: s.paused, title: s.confrontResult.title,
          moversOwnHalf: movers.map((e) => (role === 'A' ? e.body.position.y > half : e.body.position.y < half)),
          moversAtFormation: movers.map((e) => { const p = s._formPos(role, e.slot, { x: s.FIELD_W / 2, y: half }, true); return Math.hypot(p.x - e.body.position.x, p.y - e.body.position.y) < 2; }),
          stayers: stayers.map((e, i) => [e.body.position.x - ownHalf[i].x, e.body.position.y - ownHalf[i].y]),
          gkMoved: Math.hypot(gk.body.position.x - gkBefore.x, gk.body.position.y - gkBefore.y),
          nobodyInRivalHalf: out.filter((e) => (role === 'A' ? e.body.position.y < half : e.body.position.y > half)).length,
        };
      }, [role, ball, inRivalHalf, inOwnHalf]);
      expect(r.paused).toBe(true);
      expect(r.title).toContain('Offside');
      expect(r.moversOwnHalf).toEqual([true, true]);        // sent home...
      expect(r.moversAtFormation).toEqual([true, true]);    // ...to their kickoff spots
      expect(r.stayers).toEqual([[0, 0]]);                  // already home: left alone
      expect(r.gkMoved).toBe(0);
      // The flag is on screen during the freeze, not just after it.
      await expect(page.locator('#result-title')).toContainText('Offside');
      await page.waitForFunction(() => window.__scene.paused === false, { timeout: 4000 });
    });
  }
});

test.describe('stamina', () => {
  test('running drains far less than before, and duels take their own toll', async ({ page }) => {
    await match(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      const st = s.statsMapA.get(s.teamA[3].id);
      st.stamina = st.maxStamina;
      s._tickFatigue(1000);
      const perSecond = st.maxStamina - st.stamina;
      const a = s.teamA[5], b = s.teamB[5];
      const sa = s.statsMapA.get(a.id), sb = s.statsMapB.get(b.id);
      sa.stamina = sa.maxStamina; sb.stamina = sb.maxStamina;
      s.confrontation = { type: 'duel', attackerRole: 'A', defenderRole: 'B', attackerId: a.id, defenderId: b.id,
        pending: { aWins: true, aTN: 'Normal', dTN: 'Normal', fx: null, aName: 'x', dName: 'y' } };
      s._applyConfrontOutcome(s.time.now);
      return { perSecond, winner: 1 - sa.stamina / sa.maxStamina, loser: 1 - sb.stamina / sb.maxStamina };
    });
    expect(r.perSecond).toBeCloseTo(0.35 * 150 / 360, 5); // was 150/360 a second
    expect(r.winner).toBeCloseTo(0.04, 5);
    expect(r.loser).toBeCloseTo(0.07, 5);
  });
});

test.describe('Hard AI shooting', () => {
  // The rival carrier at (x, y) with every A player parked far away, and the
  // A keeper set where it covers (or doesn't) the rival's shot.
  const scene = (page, { level, y, defenderNear = false, keeperOff = false }) => page.evaluate(({ level, y, defenderNear, keeperOff }) => {
    const s = window.__scene, put = window.__put;
    s.aiLevel = level;
    s.teamA.forEach((e, i) => put(e, 40 + i * 8, 40));
    s.teamB.forEach((e, i) => put(e, 40 + i * 8, 80));
    const carrier = s.teamB.find((e) => e.slot !== 0);
    put(carrier, 480, y);
    const gk = s.teamA.find((e) => e.id === s.gkIdA);
    put(gk, keeperOff ? 900 : 480, keeperOff ? 1400 : 1460);
    if (defenderNear) put(s.teamA.find((e) => e.slot !== 0), 480, y + 60);
    const p = s._aiParams();
    let shots = 0;
    for (let i = 0; i < 60; i++) if (s._aiShouldShoot(carrier, p)) shots++;
    return shots;
  }, { level, y, defenderNear, keeperOff });

  test('at the edge of its range with the keeper set, Hard keeps carrying', async ({ page }) => {
    await match(page);
    expect(await scene(page, { level: 'hard', y: 1520 - 440 })).toBe(0);
  });
  test('close in, under pressure, or with the keeper out of position, Hard shoots', async ({ page }) => {
    await match(page);
    expect(await scene(page, { level: 'hard', y: 1520 - 200 })).toBeGreaterThan(40);
    expect(await scene(page, { level: 'hard', y: 1520 - 440, defenderNear: true })).toBeGreaterThan(40);
    expect(await scene(page, { level: 'hard', y: 1520 - 440, keeperOff: true })).toBeGreaterThan(40);
  });
  test('Normal still shoots on sight once in range', async ({ page }) => {
    await match(page);
    expect(await scene(page, { level: 'normal', y: 1520 - 440 })).toBeGreaterThan(30);
  });
});

test.describe('match time stops during duels', () => {
  /** Runs the host loop for `n` frames and reports how far the clock, stamina
   *  and the stats' minutes moved. Play is not paused, so _hostUpdate runs. */
  async function drift(page, n = 12) {
    return page.evaluate(async (n) => {
      const s = window.__scene, st = s._statsFor('A', s.teamA[6].id);
      const c = s.matchClock;
      const before = { left: c.secondsRemaining, ot: c.otElapsed || 0, sta: st.stamina, el: s.matchStats.elapsedS };
      for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
      return { left: before.left - c.secondsRemaining, ot: (c.otElapsed || 0) - before.ot, sta: before.sta - st.stamina, el: s.matchStats.elapsedS - before.el };
    }, n);
  }

  test('the clock, stamina and match minutes hold through a duel, its reveal and a shot, and run again after', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const run = await drift(page);
    expect(run.left).toBeGreaterThan(0.1); // sanity: they do move normally
    expect(run.sta).toBeGreaterThan(0);
    expect(run.el).toBeGreaterThan(0.1);

    await page.evaluate(() => { const s = window.__scene; s.confrontation = { type: 'duel', attackerRole: 'A', defenderRole: 'B', attackerId: s.teamA[5].id, defenderId: s.teamB[5].id, deadline: s.time.now + 60000, attackerChoice: null, defenderChoice: null }; });
    expect(await drift(page)).toEqual({ left: 0, ot: 0, sta: 0, el: 0 });          // choosing
    await page.evaluate(() => { const s = window.__scene; s.confrontation.reveal = { until: s.time.now + 60000, litAt: s.time.now + 60000, type: 'duel', a: {}, d: {} }; });
    expect(await drift(page)).toEqual({ left: 0, ot: 0, sta: 0, el: 0 });          // VS reveal
    await page.evaluate(() => { const s = window.__scene; s.confrontation = null; s.shotSeq = { stages: [], idx: 0 }; });
    expect(await drift(page)).toEqual({ left: 0, ot: 0, sta: 0, el: 0 });          // between a shot's stages
    await page.evaluate(() => { window.__scene.shotSeq = null; });
    const after = await drift(page);
    expect(after.left).toBeGreaterThan(0.1);
    expect(after.sta).toBeGreaterThan(0);
  });

  test('golden-goal overtime stops counting during a duel too', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    await page.evaluate(() => { const s = window.__scene; Object.assign(s.matchClock, { half: 2, overtime: true, otElapsed: 5, secondsRemaining: 0 }); s.confrontation = { type: 'duel', attackerRole: 'A', defenderRole: 'B', attackerId: s.teamA[5].id, defenderId: s.teamB[5].id, deadline: s.time.now + 60000, attackerChoice: null, defenderChoice: null }; });
    expect((await drift(page)).ot).toBe(0);
    await page.evaluate(() => { window.__scene.confrontation = null; });
    expect((await drift(page)).ot).toBeGreaterThan(0.1);
  });

  test('time up with nothing on ends the half at once; one that falls during a duel ends it right after', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const r = await page.evaluate(async () => {
      const s = window.__scene;
      const frames = (n) => new Promise((res) => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
      const out = {};
      // A duel is on as the clock hits 0:00 → it holds, the half is still the first.
      s.confrontation = { type: 'duel', attackerRole: 'A', defenderRole: 'B', attackerId: s.teamA[5].id, defenderId: s.teamB[5].id, deadline: s.time.now + 60000, attackerChoice: null, defenderChoice: null };
      s.matchClock.secondsRemaining = 0.05;
      await frames(15);
      out.during = { half: s.matchClock.half, left: s.matchClock.secondsRemaining };
      // The duel is decided → the whistle goes on the next tick.
      s.confrontation = null;
      await frames(15);
      out.after = { half: s.matchClock.half };
      return out;
    });
    expect(r.during).toEqual({ half: 1, left: 0.05 });
    expect(r.after.half).toBe(2);
  });

  test('full time waits for a shot being decided, then ends', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const r = await page.evaluate(async () => {
      const s = window.__scene;
      const frames = (n) => new Promise((res) => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
      Object.assign(s.matchClock, { half: 2, secondsRemaining: 0.05 });
      s.score.a = 1;
      s.shotSeq = { stages: [], idx: 0 };
      await frames(15);
      const held = s.matchClock.ended;
      s.shotSeq = null;
      await frames(15);
      return { held, ended: s.matchClock.ended };
    });
    expect(r).toEqual({ held: false, ended: true });
  });
});
