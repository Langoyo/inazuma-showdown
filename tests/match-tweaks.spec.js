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
  test('play freezes for a beat and the offside side restarts from behind the ball', async ({ page }) => {
    await match(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      const out = s.teamA.filter((e) => e.slot !== 0).slice(0, 2);
      s.matter.body.setPosition(s.ball, { x: 480, y: 600 });
      window.__put(out[0], 300, 400); window.__put(out[1], 700, 450);
      s._commitOffside('A', s.time.now);
      return { paused: s.paused, ys: out.map((e) => e.body.position.y), xs: out.map((e) => e.body.position.x), ballY: s.ball.position.y, title: s.confrontResult.title };
    });
    expect(r.paused).toBe(true);
    expect(r.title).toContain('Offside');
    // A attacks toward y=0, so "behind the ball" is below it.
    for (const y of r.ys) expect(y).toBeGreaterThanOrEqual(r.ballY + 39);
    expect(r.xs).toEqual([300, 700]); // they keep their lanes
    // The flag is on screen during the freeze, not just after it.
    await expect(page.locator('#result-title')).toContainText('Offside');
    await page.waitForFunction(() => window.__scene.paused === false, { timeout: 4000 });
  });
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

test.describe('time running out mid-play', () => {
  test('the half waits for a duel to finish and its result to show, then the whistle goes', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      s._setPaused(true); // drive the clock by hand, without play moving on underneath
      const out = {};
      s.confrontation = { type: 'duel', attackerRole: 'A', defenderRole: 'B', attackerId: s.teamA[5].id, defenderId: s.teamB[5].id };
      s.matchClock.secondsRemaining = 0.05;
      s._tickClock(100);
      out.duringDuel = { half: s.matchClock.half, stoppage: s.matchClock.stoppage, left: s.matchClock.secondsRemaining };
      // The duel is decided: its banner names the winner a beat later.
      s.confrontation = null;
      s.confrontResult = { title: 'x', outcome: 'y', until: s.time.now + 3000, outcomeAt: s.time.now + 800 };
      s._tickClock(100);
      out.beforeResult = s.matchClock.half;
      s.confrontResult.outcomeAt = s.time.now - 1;
      s._tickClock(100);
      out.after = { half: s.matchClock.half, stoppage: s.matchClock.stoppage };
      return out;
    });
    expect(r.duringDuel).toEqual({ half: 1, stoppage: true, left: 0 });
    expect(r.beforeResult).toBe(1);
    expect(r.after).toEqual({ half: 2, stoppage: false });
  });

  test('full time waits for a shot being decided', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      s._setPaused(true);
      Object.assign(s.matchClock, { half: 2, secondsRemaining: 0.05 });
      s.score.a = 1;
      s.shotSeq = { stages: [], idx: 0 };
      s._tickClock(100);
      const held = s.matchClock.ended;
      s.shotSeq = null; s.confrontResult = null;
      s._tickClock(100);
      return { held, ended: s.matchClock.ended };
    });
    expect(r).toEqual({ held: false, ended: true });
  });

  test('time up with nothing going on still ends the half at once', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const half = await page.evaluate(() => {
      const s = window.__scene; s._setPaused(true);
      s.confrontation = null; s.shotSeq = null;
      s.matchClock.secondsRemaining = 0.05; s._tickClock(100);
      return s.matchClock.half;
    });
    expect(half).toBe(2);
  });
});
