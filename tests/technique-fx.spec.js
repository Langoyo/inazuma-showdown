import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

// Supertechniques burst in their own element, keepers get a save flash,
// goals rain confetti. The pixels can't be asserted on, so these check the
// synced fx data and the scene's own log of which effects played.

test.describe('technique effects', () => {
  test('each element plays its own burst, and unknown elements a neutral one', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const log = await page.evaluate(() => {
      const s = window.__scene; s.fxLog = [];
      for (const el of ['Fire', 'Wood', 'Air', 'Earth', null]) s._playTechniqueFx({ x: 300, y: 500, color: 0x3399ff, name: 'Test', el, power: 80 });
      const emitters = s.children.list.filter((o) => o.type === 'ParticleEmitter').length;
      return { log: s.fxLog, emitters };
    });
    expect(log.log).toEqual(['Fire', 'Wood', 'Air', 'Earth', 'neutral']);
    expect(log.emitters).toBe(5);
    // They clean up after themselves.
    await page.waitForFunction(() => window.__scene.children.list.filter((o) => o.type === 'ParticleEmitter').length === 0, { timeout: 5000 });
  });

  test('a supertechnique in a duel carries its own element and power to the effect', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      const a = s.teamA.find((e) => { const st = s._statsFor('A', e.id); return st && s._bestTechChoice({ ...st, sp: 999 }, 'dribble') !== 'normal'; });
      if (!a) return null;
      const st = s._statsFor('A', a.id); st.sp = 999;
      const d = s.teamB[5];
      s.confrontation = { type: 'duel', attackerRole: 'A', defenderRole: 'B', attackerId: a.id, defenderId: d.id, attackerChoice: s._bestTechChoice(st, 'dribble'), defenderChoice: 'normal' };
      s._prepareConfrontReveal(s.time.now);
      const tech = s._tryTech({ ...st, sp: 999 }, 'dribble', s._bestTechChoice({ ...st, sp: 999 }, 'dribble'));
      return { fx: s.confrontation.pending.fx.a, element: tech?.element || null };
    });
    expect(r).not.toBeNull();
    expect(r.fx.el).toBe(r.element);
    expect(r.fx.power).toBeGreaterThan(0);
  });

  test('a save flashes at the keeper and a goal rains confetti', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    await page.evaluate(() => {
      const s = window.__scene; s.fxLog = [];
      s.confrontation = { type: 'shot', attackerRole: 'A', defenderRole: 'B', attackerId: s.teamA[10].id, defenderId: s.gkIdB,
        pending: { aWins: false, aTN: 'Normal', dTN: 'Normal', fx: null, aName: 'x', dName: 'y' } };
      s._applyConfrontOutcome(s.time.now);
    });
    expect(await page.evaluate(() => !!window.__scene.confrontResult.fx.save)).toBe(true);
    await page.waitForFunction(() => window.__scene.fxLog.includes('save'), { timeout: 5000 });

    await page.evaluate(() => {
      const s = window.__scene;
      s.shotSeq = { aRole: 'A', dRole: 'B', kickerId: s.teamA[10].id, names: [], stages: [], idx: 0 };
      s._shotGoesIn(s.time.now, 'into the empty net');
      // In play this runs inside the host loop, which renders the banner (and
      // so its effects) that same frame before the goal pause takes hold.
      s._renderResultBanner(s.confrontResult, s.time.now);
    });
    expect(await page.evaluate(() => !!window.__scene.confrontResult.fx.goal)).toBe(true);
    await page.waitForFunction(() => window.__scene.fxLog.includes('goal'), { timeout: 5000 });
  });

  test('strong moves shake the camera, unless reduced motion is on', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const shakes = (reduce) => page.evaluate(async () => {
      const s = window.__scene; let n = 0;
      const orig = s.cameras.main.shake.bind(s.cameras.main);
      s.cameras.main.shake = (...a) => { n++; return orig(...a); };
      s._playTechniqueFx({ x: 300, y: 500, color: 0x3399ff, name: 'Big', el: 'Fire', power: 110 });
      s._playTechniqueFx({ x: 300, y: 500, color: 0x3399ff, name: 'Small', el: 'Fire', power: 70 });
      s.cameras.main.shake = orig;
      return n;
    });
    expect(await shakes()).toBe(1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await shakes()).toBe(0);
  });
});
