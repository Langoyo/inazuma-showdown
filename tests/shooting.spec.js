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

test.describe('shooting: tap, then pick the spot and the shot', () => {
  test('one tap in the goal area shoots — play freezes on the strike, aimed at the tapped spot (inside the posts)', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, { put, park, outfield } = window.__shot;
      park();
      const shooter = outfield(s.teamA)[0];
      put(shooter, 480, 500);
      s._toWorld = (x, y) => ({ x, y });
      s.currentPossession = s.role; s.possRole = s.role; s.activeIdA = shooter.id; s.confrontation = null;
      s._pointerDown({ x: 580, y: 20 }); // in the goal area but wide of the post: clamped in
      const requested = s.pendingShoot;
      s._startConfront('shot', 'A', 'B', s.time.now, { target: requested });
      return { requested, type: s.confrontation.type, solo: s.confrontation.solo, target: s.shotSeq.target, line: s.confrontation.shotLine.to };
    });
    expect(r.requested).toEqual({ x: 542, y: 0 });
    expect(r.type).toBe('strike');
    expect(r.solo).toBe(true);
    expect(r.target).toEqual({ x: 542, y: 0 });
    expect(r.line).toEqual({ x: 542, y: 0 });
  });

  test('during the strike, goal taps move the aim, and the shot is built from wherever it ends up', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, { put, park, outfield, keeper } = window.__shot;
      park();
      const shooter = outfield(s.teamA)[0], def = outfield(s.teamB)[0];
      put(shooter, 420, 700); put(def, 360, 400); put(keeper('B'), 480, 40);
      s._toWorld = (x, y) => ({ x, y });
      s.currentPossession = s.role; s.possRole = s.role; s.activeIdA = shooter.id; s.confrontation = null;
      s._startConfront('shot', 'A', 'B', s.time.now, { target: { x: 420, y: 0 } });
      const blockedAtFirst = !!s._shotPath('A', s.shotSeq.from, s.shotSeq.target).blocker; // 60px off this line
      s._pointerDown({ x: 540, y: 30 });            // re-aim for the far post
      const tapAim = s.pendingShotAim;
      s._setShotAim('A', tapAim);                    // what the host does with it next frame
      const line = s.confrontation.shotLine.to;
      s.confrontation.attackerChoice = 'normal';
      s._prepareConfrontReveal(s.time.now);
      return { blockedAtFirst, tapAim, line, kinds: s.shotSeq ? s.shotSeq.stages.map((st) => st.kind) : null, next: s.confrontation?.type ?? null };
    });
    expect(r.blockedAtFirst).toBe(true);
    expect(r.tapAim).toEqual({ x: 540, y: 0 });
    expect(r.line).toEqual({ x: 540, y: 0 });
    expect(r.kinds).toEqual(['keeper']); // the new line clears the defender
    expect(r.next).toBe('shot');
  });

  test('left to run out, the strike is a normal shot at the current aim', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, { put, park, outfield, keeper, giveShot } = window.__shot;
      park();
      const shooter = outfield(s.teamA)[0];
      put(shooter, 480, 600); put(keeper('B'), 480, 40);
      const st = giveShot('A', shooter, 'Strike Tech', 70);
      s.possRole = 'A'; s.activeIdA = shooter.id; s.confrontation = null;
      s._startConfront('shot', 'A', 'B', s.time.now, { target: { x: 480, y: 0 } });
      const now = s.confrontation.deadline + 1;
      s._progressConfront(now, { confrontationChoice: null }, { confrontationChoice: null }, false);
      return { names: s.shotSeq.names, sp: st.sp, next: s.confrontation.type };
    });
    expect(r.names).toEqual(['Normal']);
    expect(r.sp).toBe(999); // no PT spent
    expect(r.next).toBe('shot');
  });

  test('the shot is drawn as a cone, with no keeper-chance text on the pitch', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, { put, park, outfield } = window.__shot;
      park();
      const shooter = outfield(s.teamA)[0];
      put(shooter, 480, 500);
      s.possRole = 'A'; s.currentPossession = 'A'; s.activeIdA = shooter.id; s.confrontation = null;
      s._startConfront('shot', 'A', 'B', s.time.now, { target: { x: 520, y: 0 } });
      const calls = [];
      const g = s.pathGfx, orig = g.fillTriangle.bind(g);
      g.fillTriangle = (...a) => { calls.push(a); return orig(...a); };
      s._drawPaths();
      g.fillTriangle = orig;
      return { calls, reachText: 'shotReachText' in s };
    });
    expect(r.calls).toHaveLength(1);
    const [ax, ay, bx, by, cx, cy] = r.calls[0];
    expect([ax, ay]).toEqual([480, 500]);           // apex on the shooter
    expect(by).toBe(0); expect(cy).toBe(0);         // base on the goal line
    expect((bx + cx) / 2).toBe(520);                // centred on the aim
    expect(cx - bx).toBeGreaterThan(0);
    expect(r.reachText).toBe(false);
  });
});

test.describe('keeper position and reach', () => {
  test('the keeper stands between the ball and the middle of the goal, across to the near post', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      const at = (x, y) => s._formPos('B', 0, { x, y });
      return { right: at(900, 500), left: at(60, 500), mid: at(480, 500), angled: at(640, 600), byline: at(940, 40) };
    });
    // B defends the goal on y=0, centred on x=480, posts at ±70.
    expect(r.mid.x).toBe(480);
    // A wide ball pulls the keeper well across (the old slide stopped at ±42).
    expect(r.right.x).toBeGreaterThan(480 + 42); expect(r.right.x).toBeLessThanOrEqual(480 + 62);
    expect(r.left.x).toBeLessThan(480 - 42); expect(r.left.x).toBeGreaterThanOrEqual(480 - 62);
    // Unclamped, the keeper sits right on the goal-centre → ball line.
    const cross = (r.angled.x - 480) * 600 - r.angled.y * (640 - 480);
    expect(Math.abs(cross)).toBeLessThan(1);
    // Ball level with the byline: across toward the near post, still in front of the line.
    expect(r.byline.x).toBeGreaterThan(480 + 42); expect(r.byline.x).toBeLessThanOrEqual(480 + 62);
    expect(r.byline.y).toBeGreaterThan(0);
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
      s.confrontation.attackerChoice = 'normal';
      s._prepareConfrontReveal(s.time.now);
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
      s.confrontation.attackerChoice = 'normal'; s._prepareConfrontReveal(s.time.now);
      const kinds = s.shotSeq.stages.map((st) => st.kind);
      const afterStrike = s.shotSeq.power;
      s.confrontation.attackerChoice = 'normal'; s._prepareConfrontReveal(s.time.now); // lets it run
      const afterRun = s.shotSeq.power;
      giveShot('A', m1, 'One', 80, 0); giveShot('A', m2, 'Two', 80, 0);
      start();
      s.confrontation.attackerChoice = 'normal'; s._prepareConfrontReveal(s.time.now);
      const noPt = s.shotSeq.stages.map((st) => st.kind);
      return { kinds, afterStrike, afterRun, noPt };
    });
    expect(r.kinds).toEqual(['chain', 'keeper']);
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
      s.confrontation.attackerChoice = 'normal'; s._prepareConfrontReveal(s.time.now);
      return { kinds: s.shotSeq.stages.map((st) => st.kind), next: s.confrontation.type };
    });
    expect(r.kinds).toEqual(['block', 'chain', 'keeper']);
    expect(r.next).toBe('block');
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
