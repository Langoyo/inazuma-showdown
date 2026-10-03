import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

// Every technique has its own element (Fire / Wind→Air / Forest→Wood /
// Mountain→Earth / Void), from the roster import. That element — not the
// player's — decides the elemental edge, and it's shown on the cards.

test.describe('technique elements', () => {
  test('the roster gives techniques their own element, which needn\'t be their user\'s', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(async () => {
      const roster = await (await fetch('roster.json')).json();
      let total = 0, withEl = 0, differs = 0;
      const seen = new Set();
      for (const p of roster) {
        for (const t of [...Object.values(p.techniques || {}).filter(Boolean), ...(p.techniquesExtra || [])]) {
          total++;
          if (t.element) { withEl++; seen.add(t.element); if (p.element && t.element !== p.element && t.element !== 'Void') differs++; }
        }
      }
      return { total, withEl, differs, seen: [...seen].sort() };
    });
    expect(r.withEl / r.total).toBeGreaterThan(0.95);
    expect(r.seen).toEqual(['Air', 'Earth', 'Fire', 'Void', 'Wood']);
    expect(r.differs).toBeGreaterThan(0);
  });

  test('the edge goes by the technique\'s element; a normal action uses the player\'s; Void is neutral', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      const a = s.teamA[5], d = s.teamB[5];
      const stA = s._statsFor('A', a.id), stB = s._statsFor('B', d.id);
      const duel = (techEl) => {
        stA.element = 'Fire'; stB.element = 'Earth'; // Earth beats Fire between the players themselves
        stA.techniques = { shot: null, dribble: { name: 'Test Dribble', cost: 1, power: 80, element: techEl }, defense: null, keeper: null };
        stA.techniquesExtra = []; stA.sp = 999;
        s.confrontation = { type: 'duel', attackerRole: 'A', defenderRole: 'B', attackerId: a.id, defenderId: d.id, attackerChoice: { tech: 0 }, defenderChoice: 'normal' };
        s._prepareConfrontReveal(s.time.now);
        const { a: ra, d: rd } = s.confrontation.reveal;
        return { aEl: ra.element, aEdge: ra.edge, dEl: rd.element, dEdge: rd.edge, fx: s.confrontation.pending.fx.a.el };
      };
      const air = duel('Air'); // Air beats Earth: the technique turns it round
      const voidT = duel('Void');
      // A normal dribble: the players' own elements, so Earth has it.
      stA.sp = 0;
      s.confrontation = { type: 'duel', attackerRole: 'A', defenderRole: 'B', attackerId: a.id, defenderId: d.id, attackerChoice: 'normal', defenderChoice: 'normal' };
      s._prepareConfrontReveal(s.time.now);
      const normal = { aEl: s.confrontation.reveal.a.element, dEdge: s.confrontation.reveal.d.edge };
      s.confrontation = null;
      return { air, voidT, normal };
    });
    expect(r.air).toEqual({ aEl: 'Air', aEdge: true, dEl: 'Earth', dEdge: false, fx: 'Air' });
    expect(r.voidT).toMatchObject({ aEl: 'Void', aEdge: false, dEdge: false });
    expect(r.normal).toEqual({ aEl: 'Fire', dEdge: true });
  });

  test('a shot carries the element it was struck with to the keeper', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      const shooter = s.teamA[s.teamA.length - 1];
      const stA = s._statsFor('A', shooter.id), stK = s._statsFor('B', s.gkIdB);
      stA.element = 'Earth'; stK.element = 'Wood'; stK.sp = 0;
      const tech = { name: 'Test Shot', cost: 1, power: 90, element: 'Fire' };
      s.shotSeq = { power: 100, names: [tech.name], el: s._moveElement(stA, tech), stages: [], idx: 0 };
      s.confrontation = { type: 'shot', attackerRole: 'A', defenderRole: 'B', attackerId: shooter.id, defenderId: s.gkIdB, attackerChoice: 'none', defenderChoice: 'normal', keeperReach: 1 };
      s._prepareConfrontReveal(s.time.now);
      const out = { a: s.confrontation.reveal.a.element, edge: s.confrontation.reveal.a.edge };
      s.confrontation = null; s.shotSeq = null;
      return out;
    });
    expect(r).toEqual({ a: 'Fire', edge: true }); // Fire beats Wood, though the shooter is Earth
  });

  test('the technique buttons, the matchup line and the stat sheet show each technique\'s element', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      const a = s.teamA[5], d = s.teamB[5];
      const stA = s._statsFor(s.role, a.id), stB = s._statsFor('B', d.id);
      stA.element = 'Fire';
      stA.techniques = { shot: null, dribble: { name: 'Gale Dribble', cost: 1, power: 80, element: 'Air' }, defense: null, keeper: null };
      stA.techniquesExtra = [{ name: 'Nothing Dribble', category: 'dribble', cost: 1, power: 70, element: 'Void' }];
      stA.sp = 99;
      stB.element = 'Earth';
      stB.techniques = { shot: null, dribble: null, defense: { name: 'Leaf Wall', cost: 1, power: 80, element: 'Wood' }, keeper: null };
      stB.techniquesExtra = [];
      const c = { type: 'duel', attackerRole: 'A', defenderRole: 'B', attackerId: a.id, defenderId: d.id, deadline: s.time.now + 60000, attackerChoice: null, defenderChoice: null };
      s._updateConfrontUI(c, s.time.now);
      const btns = [...document.querySelectorAll('#conf-tech-list button')].map((b) => ({ el: b.dataset.element, text: b.textContent }));
      const info = document.getElementById('confrontation-player-info').innerHTML;
      s._updateConfrontUI(null, s.time.now);
      return { btns, info };
    });
    expect(r.btns[0].el).toBe('Air');
    expect(r.btns[0].text).toContain('Air');
    expect(r.btns[0].text).not.toContain('beats');
    expect(r.btns[1].el).toBe('Void');
    // Both players' own elements, mine first, with the element wheel between.
    expect(r.info).toMatch(/conf-matchup.*You.*el-Fire.*el-wheel.*el-Earth/);

    const p = await page.evaluate(() => window.__scene.rosterAll.find((pl) => Object.values(pl.techniques || {}).some((t) => t?.element && t.element !== pl.element)));
    await page.evaluate((pl) => window.__scene._showPlayerStats(pl), p);
    const tech = Object.values(p.techniques).find((t) => t?.element && t.element !== p.element);
    await expect(page.locator('#player-stat-panel')).toContainText(tech.name);
    await expect(page.locator(`#player-stat-panel .el-${tech.element}`).first()).toBeVisible();
  });
});

test.describe('element wheel', () => {
  test('the VS card shows the wheel: both elements ringed in their team colours, the winning arrow lit', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const read = (a, d) => page.evaluate(([a, d]) => {
      const s = window.__scene;
      const rv = { type: 'duel', lit: false,
        a: { id: s.teamA[5].id, name: 'A', move: 'Normal', winner: true, element: a, edge: false, color: '#ff0000' },
        d: { id: s.teamB[5].id, name: 'D', move: 'Normal', winner: false, element: d, edge: false, color: '#0000ff' } };
      s._renderDuelReveal(rv);
      const svg = document.querySelector('#duel-vs .el-wheel');
      const ringed = [...svg.querySelectorAll('.ew-node')].filter((g) => g.querySelectorAll('circle').length > 1).map((g) => g.dataset.el);
      const strokes = [...svg.querySelectorAll('.ew-node circle')].map((c) => c.getAttribute('stroke'));
      const hot = svg.querySelectorAll('.ew-arrow.hot').length;
      s._renderDuelReveal(rv); // same matchup again: the same SVG stays (its animation keeps running)
      return { nodes: svg.querySelectorAll('.ew-node').length, ringed, red: strokes.includes('#ff0000'), blue: strokes.includes('#0000ff'), hot, kept: document.querySelector('#duel-vs .el-wheel') === svg };
    }, [a, d]);
    expect(await read('Fire', 'Wood')).toEqual({ nodes: 4, ringed: ['Fire', 'Wood'], red: true, blue: true, hot: 1, kept: true });
    // Fire and Air sit opposite each other on the wheel: neither beats the other.
    expect(await read('Fire', 'Air')).toMatchObject({ ringed: ['Fire', 'Air'], hot: 0 });
    // A Void move isn't on the wheel at all.
    expect(await read('Void', 'Earth')).toMatchObject({ ringed: ['Earth'], hot: 0 });
  });
});

test.describe('stamina and match length', () => {
  test('running and duels drain in proportion to the half length', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      const id = s.teamA[5].id, st = s._statsFor('A', id);
      const drain = (halfS) => {
        s.halfLengthS = halfS;
        st.stamina = st.maxStamina; s._tickFatigue(10000);
        const run = st.maxStamina - st.stamina;
        st.stamina = st.maxStamina; s._duelStaminaCost('A', id, false, true);
        return { run, duel: st.maxStamina - st.stamina };
      };
      return { three: drain(180), six: drain(360), two: drain(120) };
    });
    expect(r.six.run).toBeCloseTo(r.three.run / 2, 5);
    expect(r.six.duel).toBeCloseTo(r.three.duel / 2, 5);
    expect(r.two.run).toBeCloseTo(r.three.run * 1.5, 5);
    expect(r.two.duel).toBeCloseTo(r.three.duel * 1.5, 5);
  });
});

test.describe('mouse wheel', () => {
  test('scrolling over the pitch pans the camera', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const box = await page.locator('canvas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const before = await page.evaluate(() => window.__scene.cameras.main.scrollY);
    await page.mouse.wheel(0, 200);
    await page.waitForFunction((b) => window.__scene.cameras.main.scrollY > b, before, { timeout: 3000 });
    const down = await page.evaluate(() => window.__scene.cameras.main.scrollY);
    await page.mouse.wheel(0, -400);
    await page.waitForFunction((d) => window.__scene.cameras.main.scrollY < d, down, { timeout: 3000 });
  });
});

test.describe('landscape fits the pitch to the screen width', () => {
  // Touch devices only: the default test browser has a mouse (pointer: fine),
  // so a touch screen is faked by answering the media query.
  const touch = (page) => page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/pointer:\s*coarse/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : real(q));
  });
  async function started(page, w, h, { touchScreen = true } = {}) {
    if (touchScreen) await touch(page);
    await page.setViewportSize({ width: w, height: h });
    await waitForRosterLoaded(page);
    await startMatch(page);
    await page.waitForTimeout(300);
  }
  const cam = (page) => page.evaluate(() => {
    const s = window.__scene, c = s.cameras.main;
    const wp = c.getWorldPoint(300, 120), mine = s._toWorld(300, 120);
    return { zoom: c.zoom, vp: [s.VP_W, s.VP_H], viewW: c.worldView.width, viewX: c.worldView.x, scrollX: c.scrollX, scrollY: c.scrollY,
      matches: Math.abs(wp.x - mine.x) < 1 && Math.abs(wp.y - mine.y) < 1 }; // Phaser rounds the camera to whole pixels
  });

  test('a wide landscape screen scales the 960px pitch to its width, with no sideways scrolling', async ({ page }) => {
    await started(page, 1400, 600);
    const r = await cam(page);
    expect(r.zoom).toBeCloseTo(1400 / 960, 3);
    expect(r.viewW).toBeCloseTo(960, 0); // the whole width of the pitch, edge to edge
    expect(r.viewX).toBeCloseTo(0, 0);
    expect(r.matches).toBe(true); // taps land where Phaser draws
    // The wheel only moves it up and down: the width is already fully in view.
    const x0 = r.scrollX;
    const box = await page.locator('canvas').boundingBox();
    await page.mouse.move(box.x + 500, box.y + 300);
    await page.mouse.wheel(300, 0);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__scene.cameras.main.scrollX)).toBeCloseTo(x0, 3);
    const y0 = r.scrollY;
    await page.mouse.wheel(0, 200);
    await page.waitForFunction((y) => window.__scene.cameras.main.scrollY > y, y0, { timeout: 3000 });
  });

  test('a desktop window (mouse) stays 1:1 at any size, wide or not', async ({ page }) => {
    await started(page, 1400, 600, { touchScreen: false });
    const r = await cam(page);
    expect(r.zoom).toBe(1);
    expect(r.viewW).toBeCloseTo(1400, 0);
    expect(r.matches).toBe(true);
  });

  test('a phone in landscape shows the whole width too; rotating back to portrait returns to 1:1', async ({ page }) => {
    await started(page, 412, 915);
    expect((await cam(page)).zoom).toBe(1);
    await page.setViewportSize({ width: 915, height: 412 });
    await page.waitForTimeout(500);
    const land = await cam(page);
    expect(land.zoom).toBeCloseTo(915 / 960, 3);
    expect(land.viewW).toBeCloseTo(960, 0);
    expect(land.matches).toBe(true);
    await page.setViewportSize({ width: 412, height: 915 });
    await page.waitForTimeout(500);
    const port = await cam(page);
    expect(port.zoom).toBe(1);
    expect(port.matches).toBe(true);
  });

  test('the camera stays on the same part of the pitch through a rotation', async ({ page }) => {
    await started(page, 412, 915);
    const focus = () => page.evaluate(() => { const s = window.__scene, c = s.cameras.main; return { x: c.scrollX + s.VP_W / 2, y: c.scrollY + s.VP_H / 2 }; });
    await page.evaluate(() => { const c = window.__scene.cameras.main; c.scrollY = 700; });
    const before = await focus();
    await page.setViewportSize({ width: 915, height: 412 });
    await page.waitForTimeout(500);
    const after = await focus();
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  });
});
