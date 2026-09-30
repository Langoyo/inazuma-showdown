import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

// Pitch is 960 x 1520. You (team A) shoot at the goal on y=0, the AI (B) at
// y=1520. Each scene is laid out and checked inside one page.evaluate, so no
// physics step runs in between.

async function setup(page) {
  await waitForRosterLoaded(page);
  await startMatch(page);
  await page.evaluate(() => {
    const s = window.__scene;
    const put = (e, x, y) => { s.matter.body.setPosition(e.body, { x, y }); s.matter.body.setVelocity(e.body, { x: 0, y: 0 }); };
    window.__shot = {
      put,
      // Everyone out of the way, near their own goal and well wide of it.
      park() {
        s.teamA.forEach((e, i) => put(e, 900 - i * 12, 1490));
        s.teamB.forEach((e, i) => put(e, 60 + i * 12, 30));
      },
      outfield(team) { return team.filter((e) => e.slot !== 0); },
      keeper(role) { return (role === 'A' ? s.teamA : s.teamB).find((e) => e.id === (role === 'A' ? s.gkIdA : s.gkIdB)); },
      giveShot(role, e, name, power, sp = 999) {
        const st = (role === 'A' ? s.statsMapA : s.statsMapB).get(e.id);
        st.techniques = { shot: { name, cost: 10, power, cooldown: 0 }, dribble: null, defense: null, keeper: null };
        st.techniquesExtra = []; st.sp = sp; st.element = null;
        return st;
      },
    };
  });
}

test.describe('aiming a shot', () => {
  test('first tap in the goal area aims, the second shoots at that spot, and the aim stays inside the posts', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      s._toWorld = (x, y) => ({ x, y });
      s.currentPossession = s.role; s.confrontation = null;
      s._pointerDown({ x: 580, y: 20 });          // in the goal area but wide of the post: clamped in
      const aim = { ...s.shotAim }, firedEarly = s.pendingShoot;
      s._pointerDown({ x: 450, y: 40 });          // anywhere in the goal area fires
      return { aim, firedEarly, fired: s.pendingShoot, aimAfter: s.shotAim ?? null };
    });
    expect(r.firedEarly).toBe(false);
    expect(r.aim).toEqual({ x: 480 + 62, y: 0 });
    expect(r.fired).toEqual({ x: 542, y: 0 });
    expect(r.aimAfter).toBeNull();
  });

  test('a tap away from the goal while aimed just drops the aim — no pass, no run', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      s._toWorld = (x, y) => ({ x, y });
      s.currentPossession = s.role; s.confrontation = null;
      s._pointerDown({ x: 480, y: 30 });
      s._pointerDown({ x: 480, y: 700 });
      s._pointerUp();
      return { aim: s.shotAim ?? null, shoot: s.pendingShoot, pass: s.pendingPass, drawing: !!s.drawing };
    });
    expect(r).toEqual({ aim: null, shoot: false, pass: null, drawing: false });
  });

  test('once aimed, the line and keeper reach are drawn', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      s.currentPossession = s.role; s.possRole = s.role; s.confrontation = null;
      s.shotAim = { x: 520, y: 0 };
      s._drawPaths();
      return { visible: s.shotReachText.visible, text: s.shotReachText.text };
    });
    expect(r.visible).toBe(true);
    expect(r.text).toMatch(/^Keeper reach \d+%$/);
  });
});

test.describe('keeper position and reach', () => {
  test('the keeper slides along the line toward the ball, within the goal', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      return { right: s._formPos('B', 0, { x: 900, y: 500 }).x, left: s._formPos('B', 0, { x: 60, y: 500 }).x, mid: s._formPos('B', 0, { x: 480, y: 500 }).x };
    });
    expect(r.mid).toBe(480);
    expect(r.right).toBeGreaterThan(480); expect(r.right).toBeLessThanOrEqual(480 + 42);
    expect(r.left).toBeLessThan(480); expect(r.left).toBeGreaterThanOrEqual(480 - 42);
  });

  test('a shot at the keeper is fully covered, the far corner less so, and a keeper you have gone past not at all', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, { put, park, keeper } = window.__shot;
      park();
      const gk = keeper('B');
      put(gk, 480, 40);
      const atKeeper = s._keeperReach('B', { x: 480, y: 400 }, { x: 480, y: 0 });
      const corner = s._keeperReach('B', { x: 480, y: 400 }, { x: 542, y: 0 });
      put(gk, 480, 120);
      const past = s._keeperReach('B', { x: 480, y: 25 }, { x: 480, y: 0 });
      return { atKeeper, corner, past };
    });
    expect(r.atKeeper).toBe(1);
    expect(r.corner).toBeLessThan(r.atKeeper);
    expect(r.corner).toBeGreaterThan(0);
    expect(r.past).toBe(0);
  });

  test('with the keeper beaten, the shot goes straight in with no save to make', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, { put, park, keeper, outfield } = window.__shot;
      park();
      const shooter = outfield(s.teamA)[0];
      put(shooter, 480, 60); put(keeper('B'), 480, 200);
      s.possRole = 'A'; s.activeIdA = shooter.id; s.confrontation = null;
      const before = s.score.a;
      s._startConfront('shot', 'A', 'B', s.time.now, { target: { x: 470, y: 0 } });
      return { scored: s.score.a - before, confrontation: s.confrontation, seq: s.shotSeq };
    });
    expect(r.scored).toBe(1);
    expect(r.confrontation).toBeNull();
    expect(r.seq).toBeNull();
  });

  test('a poorly placed keeper saves far less often than one right on the shot', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, { outfield, keeper } = window.__shot;
      const shooter = outfield(s.teamA)[0], gk = keeper('B');
      s.shotSeq = null;
      const rate = (reach) => {
        let wins = 0;
        for (let i = 0; i < 2000; i++) {
          s.statsMapA.get(shooter.id).sp = 0; s.statsMapB.get(gk.id).sp = 0;
          s.confrontation = { type: 'shot', attackerRole: 'A', defenderRole: 'B', attackerId: shooter.id, defenderId: gk.id,
            deadline: s.time.now + 1, attackerChoice: 'normal', defenderChoice: 'normal', attackerLocked: true, keeperReach: reach };
          s._prepareConfrontReveal(s.time.now);
          if (s.confrontation.pending.aWins) wins++;
        }
        return wins / 2000;
      };
      return { covered: rate(1), stretched: rate(0.25) };
    });
    expect(r.stretched).toBeGreaterThan(r.covered + 0.15);
  });
});

test.describe('chain shots', () => {
  test('a teammate on the line chains it: strike, then chain, then the keeper faces both powers added', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, { put, park, keeper, outfield, giveShot } = window.__shot;
      park();
      const [shooter, mate] = outfield(s.teamA);
      put(shooter, 480, 700); put(mate, 490, 400); put(keeper('B'), 480, 40);
      giveShot('A', shooter, 'Strike Tech', 70);
      giveShot('A', mate, 'Chain Tech', 80);
      s.possRole = 'A'; s.activeIdA = shooter.id; s.confrontation = null;
      const now = s.time.now;
      s._startConfront('shot', 'A', 'B', now, { target: { x: 480, y: 0 } });
      const first = { type: s.confrontation.type, solo: s.confrontation.solo, who: s.confrontation.attackerId === shooter.id };
      const expectStrike = s._kickPower('A', shooter.id, { power: 70 });
      const expectChain = s._kickPower('A', mate.id, { power: 80 });
      s.confrontation.attackerChoice = { tech: 0 };
      s._prepareConfrontReveal(now);
      const second = { type: s.confrontation.type, who: s.confrontation.attackerId === mate.id, power: s.shotSeq.power };
      s.confrontation.attackerChoice = { tech: 0 };
      s._prepareConfrontReveal(now);
      const third = { type: s.confrontation.type, locked: s.confrontation.attackerLocked, kicker: s.shotSeq.kickerId === mate.id, power: s.shotSeq.power };
      s.confrontation.defenderChoice = 'normal';
      s._prepareConfrontReveal(now);
      return { first, second, third, expectStrike, expectChain, move: s.confrontation.reveal.a.move };
    });
    expect(r.first).toEqual({ type: 'strike', solo: true, who: true });
    expect(r.second.type).toBe('chain');
    expect(r.second.who).toBe(true);
    expect(r.second.power).toBeCloseTo(r.expectStrike, 6);
    expect(r.third.type).toBe('shot');
    expect(r.third.locked).toBe(true);
    expect(r.third.kicker).toBe(true);
    expect(r.third.power).toBeCloseTo(r.expectStrike + r.expectChain, 6);
    expect(r.move).toBe('Strike Tech + Chain Tech');
  });

  test('"Let it run" adds nothing, a teammate without the PT is skipped, and only one teammate chains', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, { put, park, keeper, outfield, giveShot } = window.__shot;
      const start = () => { s.possRole = 'A'; s.confrontation = null; s._startConfront('shot', 'A', 'B', s.time.now, { target: { x: 480, y: 0 } }); };
      park();
      const [shooter, m1, m2] = outfield(s.teamA);
      s.activeIdA = shooter.id;
      put(shooter, 480, 800); put(m1, 480, 550); put(m2, 480, 300); put(keeper('B'), 480, 40);
      giveShot('A', shooter, 'Strike Tech', 70); giveShot('A', m1, 'One', 80); giveShot('A', m2, 'Two', 80);
      start();
      const kinds = s.shotSeq.stages.map((st) => st.kind);
      s.confrontation.attackerChoice = 'normal'; s._prepareConfrontReveal(s.time.now);
      const afterStrike = s.shotSeq.power;
      s.confrontation.attackerChoice = 'normal'; s._prepareConfrontReveal(s.time.now); // lets it run
      const afterRun = s.shotSeq.power;
      giveShot('A', m1, 'One', 80, 0); giveShot('A', m2, 'Two', 80, 0);
      start();
      const noPt = s.shotSeq.stages.map((st) => st.kind);
      return { kinds, afterStrike, afterRun, noPt };
    });
    expect(r.kinds).toEqual(['strike', 'chain', 'keeper']);
    expect(r.afterRun).toBe(r.afterStrike);
    expect(r.noPt).toEqual(['keeper']);
  });

  test('a defender and a teammate on the line are met in the order the ball reaches them', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, { put, park, keeper, outfield, giveShot } = window.__shot;
      park();
      const [shooter, mate] = outfield(s.teamA), [def] = outfield(s.teamB);
      put(shooter, 480, 700); put(def, 480, 550); put(mate, 480, 300); put(keeper('B'), 480, 40);
      giveShot('A', mate, 'Chain Tech', 80);
      s.possRole = 'A'; s.activeIdA = shooter.id; s.confrontation = null;
      s._startConfront('shot', 'A', 'B', s.time.now, { target: { x: 480, y: 0 } });
      return { kinds: s.shotSeq.stages.map((st) => st.kind), first: s.confrontation.type };
    });
    // Blocker first, so the shooter picks blind against them as before.
    expect(r.kinds).toEqual(['block', 'chain', 'keeper']);
    expect(r.first).toBe('block');
  });
});

test.describe('AI shooting', () => {
  test('aims for the side of the goal its keeper is not covering', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, { put, park, keeper, outfield } = window.__shot;
      park();
      s.aiLevel = 'expert';
      const shooter = outfield(s.teamB)[0];
      s.possRole = 'B'; s.activeIdB = shooter.id;
      put(shooter, 480, 1150);
      put(keeper('A'), 440, 1480);
      const left = s._aiPickShotAim().x;
      put(keeper('A'), 520, 1480);
      const right = s._aiPickShotAim().x;
      return { left, right };
    });
    expect(r.left).toBeGreaterThan(480);  // keeper leaning left -> shoot right
    expect(r.right).toBeLessThan(480);
  });
});
