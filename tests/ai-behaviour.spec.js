import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

// Each scenario is laid out and evaluated inside a single page.evaluate, so
// no physics step runs between placing players and reading the decision.
// Pitch is 960 x 1520: team A defends the bottom (y=1520), team B (the AI)
// defends the top (y=0) and attacks downward.

async function setup(page) {
  await waitForRosterLoaded(page);
  await startMatch(page);
  await page.evaluate(() => {
    const s = window.__scene;
    window.__ai = {
      put(e, x, y) { s.matter.body.setPosition(e.body, { x, y }); s.matter.body.setVelocity(e.body, { x: 0, y: 0 }); },
      putBall(x, y) { s.matter.body.setPosition(s.ball, { x, y }); s.matter.body.setVelocity(s.ball, { x: 0, y: 0 }); },
      // Everyone deep near their own goal line, out of the way.
      park() {
        s.teamA.forEach((e, i) => window.__ai.put(e, 900 - i * 12, 1490));
        s.teamB.forEach((e, i) => window.__ai.put(e, 60 + i * 12, 30));
      },
      outfield(team) { return team.filter((e) => e.slot !== 0); },
    };
  });
}

test.describe('AI defending', () => {
  test('the nearest free defender presses the carrier goal-side; a far one does not', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, { put, park, outfield } = window.__ai;
      park();
      const carrier = outfield(s.teamA)[5];
      const [chaser, near, far] = outfield(s.teamB);
      s.possRole = 'A'; s.activeIdA = carrier.id; s.activeIdB = chaser.id;
      put(carrier, 480, 760);
      put(chaser, 480, 730);
      put(near, 580, 700);   // ~117px from the carrier
      put(far, 80, 300);
      const plan = s._defensivePlan('B', chaser.id, carrier);
      return { near: plan.get(near.id), far: plan.get(far.id) ?? null, chaser: plan.get(chaser.id) ?? null };
    });
    expect(r.near.blend).toBe(1);
    expect(r.near.x).toBeCloseTo(480, 0);
    expect(r.near.y).toBeLessThan(760); // goal-side: B's goal is at y=0
    expect(r.far?.blend).not.toBe(1);
    expect(r.chaser).toBeNull(); // the active player already goes for the ball
  });

  test('a runner behind the ball is picked up by one marker, from the goal side', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, { put, park, outfield } = window.__ai;
      park();
      const [carrier, runner] = outfield(s.teamA);
      const [chaser, ...defenders] = outfield(s.teamB);
      s.possRole = 'A'; s.activeIdA = carrier.id; s.activeIdB = chaser.id;
      put(carrier, 480, 900);
      put(chaser, 480, 870);
      window.__ai.putBall(480, 900);
      // Stand the runner right on a defender's formation spot, nearer B's
      // goal than the ball (a run in behind), and bring that defender and a
      // second one close enough that both could take the runner.
      const roles = ['GK', ...Array(10)].map((_, i) => s._formPos('B', i, s.ball.position));
      const d1 = defenders.find((e) => e.slot >= 1 && e.slot <= 4);
      const home = roles[d1.slot];
      put(runner, home.x, home.y + 60);
      put(d1, home.x, home.y);
      const plan = s._defensivePlan('B', chaser.id, carrier);
      const onRunner = [...plan.values()].filter((j) => j.runnerId === runner.id);
      return { count: onRunner.length, job: onRunner[0], runnerY: home.y + 60 };
    });
    expect(r.count).toBe(1);
    expect(r.job.y).toBeLessThan(r.runnerY); // between the runner and B's goal
    expect(r.job.blend).toBeLessThan(1);     // shape is kept, not abandoned
  });
});

test.describe('AI defence by difficulty', () => {
  test('on normal the rival presses from closer in and marks more loosely than on hard', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, { put, park, outfield } = window.__ai;
      const run = (level) => {
        park();
        s.aiLevel = level;
        const [carrier, runner] = outfield(s.teamA);
        const [chaser, near, ...defenders] = outfield(s.teamB);
        s.possRole = 'A'; s.activeIdA = carrier.id; s.activeIdB = chaser.id;
        put(carrier, 480, 760); put(chaser, 480, 730);
        put(near, 480 + 200, 760);   // 200px away: inside hard's press range, outside normal's
        window.__ai.putBall(480, 760);
        const d1 = defenders.find((e) => e.slot >= 1 && e.slot <= 4);
        const home = s._formPos('B', d1.slot, s.ball.position);
        put(runner, home.x, home.y + 60);
        const plan = s._defensivePlan('B', chaser.id, carrier);
        return { pressed: plan.get(near.id)?.blend === 1, markBlend: [...plan.values()].find((j) => j.runnerId === runner.id)?.blend };
      };
      return { normal: run('normal'), hard: run('hard') };
    });
    expect(r.hard.pressed).toBe(true);
    expect(r.normal.pressed).toBe(false);
    expect(r.normal.markBlend).toBeLessThan(r.hard.markBlend);
  });
});

test.describe('spacing and width off the ball', () => {
  test('a target on top of a teammate is pushed out of their space; a clear one is left alone', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, { put, park, outfield } = window.__ai;
      park();
      const [a, b] = outfield(s.teamA);
      put(b, 480, 800);
      const crowded = s._applySpacing('A', a, { x: 480, y: 800 });
      const clear = s._applySpacing('A', a, { x: 480, y: 500 });
      return { crowdedDist: Math.hypot(crowded.x - 480, crowded.y - 800), clear };
    });
    expect(r.crowdedDist).toBeGreaterThan(60);
    expect(r.clear).toEqual({ x: 480, y: 500 });
  });

  test('in possession a wide player holds near the touchline, a central one stays central', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      s.formation.A = '4-4-2'; // slot 5 is the left midfielder (x .15), slot 6 central (x .38)
      const left = s.teamA.find((e) => e.slot === 5), right = s.teamA.find((e) => e.slot === 8);
      const central = s.teamA.find((e) => e.slot === 6);
      return {
        left: s._holdWidth('A', left, { x: 300, y: 700 }).x,
        right: s._holdWidth('A', right, { x: 660, y: 700 }).x,
        central: s._holdWidth('A', central, { x: 400, y: 700 }).x,
      };
    });
    expect(r.left).toBeLessThan(200);
    expect(r.right).toBeGreaterThan(760);
    expect(r.central).toBe(400);
  });
});

test.describe('AI passing reads your players', () => {
  // B passer at (480, 500), everyone else on B bunched within 40px of them
  // (too close to be a pass option), so the one receiver is the only choice.
  const scene = () => {
    const s = window.__scene, { put, park, outfield } = window.__ai;
    park();
    s.aiLevel = 'normal';
    const [passer, receiver, ...rest] = outfield(s.teamB);
    rest.forEach((e, i) => put(e, 470 + (i % 3) * 10, 480 + Math.floor(i / 3) * 10));
    s.possRole = 'B'; s.activeIdB = passer.id;
    put(passer, 480, 500); window.__ai.putBall(480, 505);
    put(receiver, 480, 800);
    return { s, put, passer, receiver, a: outfield(s.teamA) };
  };

  test('an open receiver gets the pass', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(`(() => { const { s, passer, receiver } = (${scene})();
      s.aiLevel = 'easy'; Math.random = () => 0.99; // no through-ball roll
      const p = s._aiPickPassTarget('B', passer); return p && { id: p.entry.id, want: receiver.id, x: p.x, y: p.y }; })()`);
    expect(r.id).toBe(r.want);
    expect([r.x, r.y]).toEqual([480, 800]);
  });

  test('a receiver with one of your players standing on them is not an option', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(`(() => { const { s, put, passer, a } = (${scene})();
      Math.random = () => 0.99; put(a[0], 500, 820); return s._aiPickPassTarget('B', passer); })()`);
    expect(r).toBeNull();
  });

  test('a defender who would reach the rolling ball first rules the pass out, even off the line', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(`(() => { const { s, put, passer, a } = (${scene})();
      Math.random = () => 0.99;
      put(a[0], 530, 740); // 50px off the lane, three quarters of the way along
      return s._aiPickPassTarget('B', passer); })()`);
    expect(r).toBeNull();
  });

  test('a defender under the chipped first half of the pass does not stop it', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(`(() => { const { s, put, passer, a } = (${scene})();
      Math.random = () => 0.99;
      put(a[0], 490, 580); // right on the line, but where the ball is still in the air
      return s._aiPickPassTarget('B', passer) !== null; })()`);
    expect(r).toBe(true);
  });

  test('prefers the receiver with fewer of your players between them and goal', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(`(() => { const { s, put, passer, receiver, a } = (${scene})();
      Math.random = () => 0.99;
      const other = s.teamB.find((e) => e.slot !== 0 && e.id !== passer.id && e.id !== receiver.id);
      put(receiver, 190, 800);      // left: open road to goal
      put(other, 770, 800);         // right: three of yours in front of them
      put(a[0], 740, 1000); put(a[1], 800, 1000); put(a[2], 770, 1080);
      const p = s._aiPickPassTarget('B', passer);
      return { chosen: p.entry.id, left: receiver.id }; })()`);
    expect(r.chosen).toBe(r.left);
  });

  test('with your back line high, an onside runner is found with a ball into the space behind it', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(`(() => { const { s, put, passer, receiver, a } = (${scene})();
      s.aiLevel = 'expert';               // always considers a through ball
      put(s.teamA.find((e) => e.slot === 0), 480, 1500);
      // Every outfield player of yours on a back line at y=1060, well wide of
      // the runner's channel, so the keeper is the only one behind it.
      a.forEach((e, i) => put(e, i % 2 ? 710 + (i >> 1) * 50 : 250 - (i >> 1) * 50, 1060));
      put(receiver, 480, 1000);           // 60px short of the line: onside
      const p = s._aiPickPassTarget('B', passer);
      return p && { through: p.through, y: p.y, runnerY: 1000, id: p.entry.id, want: receiver.id }; })()`);
    expect(r.id).toBe(r.want);
    expect(r.through).toBe(true);
    expect(r.y).toBeGreaterThan(r.runnerY); // aimed into the space, not at their feet
  });
});

test.describe('AI ball carrier', () => {
  test('dribbles round a blocked middle down a wing, then cuts inside near goal', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, { put, park, outfield } = window.__ai;
      park();
      s.aiLevel = 'normal'; s._aiLaneX = undefined;
      const carrier = outfield(s.teamB)[0], a = outfield(s.teamA);
      put(carrier, 480, 450);
      put(a[0], 480, 610); put(a[1], 390, 620); put(a[2], 570, 620);
      const blocked = s._aiCarrierTarget(carrier);
      put(carrier, 480, 1520 - 445 - 50); // inside shootRange + the cut-in margin
      const near = s._aiCarrierTarget(carrier);
      return { blockedX: blocked.x, near };
    });
    expect(r.blockedX <= 960 * 0.3 || r.blockedX >= 960 * 0.7).toBe(true);
    expect(r.near).toEqual({ x: 480, y: 1520 });
  });

  test('holds a newly received ball before passing it on', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      const [p1, p2] = s.teamB.filter((e) => e.slot !== 0);
      const t0 = 100000;
      return {
        atOnce: s._aiMayPass(p1, t0),
        justBefore: s._aiMayPass(p1, t0 + 850),
        after: s._aiMayPass(p1, t0 + 950),
        newCarrier: s._aiMayPass(p2, t0 + 960), // the hold restarts for someone else
      };
    });
    expect(r).toEqual({ atOnce: false, justBefore: false, after: true, newCarrier: false });
  });
});
