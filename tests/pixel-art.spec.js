import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

// The match is drawn in pixel art, generated in code (src/gfx/pixelArt.js):
// footballer sprites (base / team-tinted kit / portrait-tinted hair) with a
// run cycle, a spinning ball, a striped pitch and pixel markers.

async function match(page) {
  await waitForRosterLoaded(page);
  await startMatch(page);
  await page.waitForTimeout(300);
}
/** Runs `step(i)` once per rendered frame, `n` times. */
const frames = (page, n, fnSrc) => page.evaluate(async ([n, src]) => {
  const step = new Function('s', 'i', src);
  for (let i = 0; i < n; i++) { step(window.__scene, i); await new Promise((r) => requestAnimationFrame(r)); }
}, [n, fnSrc]);

test.describe('pixel art', () => {
  test('pixel-art rendering is on and every texture the match uses exists', async ({ page }) => {
    await match(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, t = s.textures;
      const keys = ['px-pl-base', 'px-pl-keeper', 'px-pl-kit', 'px-pl-hair', 'px-ball', 'px-shadow', 'px-ring', 'px-ellipse', 'px-arrow', 'px-pitch'];
      return {
        pixelArt: s.game.config.pixelArt === true && s.game.config.antialias === false,
        missing: keys.filter((k) => !t.exists(k)),
        playerFrames: ['idle', 'run1', 'run2', 'run3'].every((f) => t.get('px-pl-base').has(f) && t.get('px-pl-kit').has(f) && t.get('px-pl-hair').has(f)),
        ballFrames: ['b0', 'b1', 'b2', 'b3'].every((f) => t.get('px-ball').has(f)),
      };
    });
    expect(r).toEqual({ pixelArt: true, missing: [], playerFrames: true, ballFrames: true });
  });

  test('kits wear the team colour, keepers a darker shade with gloves on', async ({ page }) => {
    await match(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      const lum = (c) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
      const outfield = s.teamA.filter((e) => e.id !== s.gkIdA && !s._isStunned(e.id, s.time.now));
      const gk = s.teamA.find((e) => e.id === s.gkIdA);
      return {
        outfield: outfield.every((e) => e.gfx.px.kit.tintTopLeft === s.teamColorA),
        gkDarker: lum(gk.gfx.px.kit.tintTopLeft) < lum(s.teamColorA) || s.teamColorA === 0,
        gkGloves: gk.gfx.px.base.texture.key === 'px-pl-keeper',
        othersNoGloves: outfield.every((e) => e.gfx.px.base.texture.key === 'px-pl-base'),
      };
    });
    expect(r).toEqual({ outfield: true, gkDarker: true, gkGloves: true, othersNoGloves: true });
  });

  test('hair takes each player\'s colour from their portrait, and follows a substitution', async ({ page }) => {
    await match(page);
    // Portraits load in the background: wait until most sprites have their own colour.
    await page.waitForFunction(() => [...window.__scene.teamA, ...window.__scene.teamB].filter((e) => e.gfx.px.hairTint != null).length >= 18, { timeout: 15000 });
    const varied = await page.evaluate(() => new Set([...window.__scene.teamA, ...window.__scene.teamB].map((e) => e.gfx.px.hairTint)).size);
    expect(varied).toBeGreaterThan(3); // not one colour for everybody
    // Swap who an entry is (as a substitution does), then swap back.
    const res = await page.evaluate(async () => {
      const s = window.__scene, e = s.teamA[5], orig = e.id, before = e.gfx.px.hairTint;
      const other = [...s.teamA, ...s.teamB].find((x) => x.gfx.px.hairTint !== before);
      e.id = other.id; s._relabelEntry(e);
      await new Promise((r) => setTimeout(r, 300));
      const swapped = e.gfx.px.hairTint;
      e.id = orig; s._relabelEntry(e);
      await new Promise((r) => setTimeout(r, 300));
      return { changed: swapped === other.gfx.px.hairTint && swapped !== before, back: e.gfx.px.hairTint === before };
    });
    expect(res).toEqual({ changed: true, back: true });
  });

  test('a running player cycles run frames and faces the way they go; standing still shows the idle frame', async ({ page }) => {
    await match(page);
    await page.evaluate(() => window.__scene._setPaused(true)); // physics frozen: the test moves the body itself
    const seen = { right: new Set(), left: new Set() };
    await frames(page, 30, `const e=s.teamA[6]; s.matter.body.setPosition(e.body,{x:e.body.position.x+4,y:e.body.position.y}); (window.__seen??=[]).push([e.gfx.px.frame,e.gfx.scaleX]);`);
    const right = await page.evaluate(() => { const r = window.__seen.slice(8); window.__seen = []; return r; });
    await frames(page, 30, `const e=s.teamA[6]; s.matter.body.setPosition(e.body,{x:e.body.position.x-4,y:e.body.position.y}); (window.__seen??=[]).push([e.gfx.px.frame,e.gfx.scaleX]);`);
    const left = await page.evaluate(() => { const r = window.__seen.slice(8); window.__seen = []; return r; });
    await frames(page, 10, ``);
    const still = await page.evaluate(() => window.__scene.teamA[6].gfx.px.frame);
    right.forEach(([f]) => seen.right.add(f)); left.forEach(([f]) => seen.left.add(f));
    expect([...seen.right].every((f) => f.startsWith('run'))).toBe(true);
    expect(seen.right.size).toBeGreaterThan(1); // it actually cycles
    expect(right.at(-1)[1]).toBe(1);
    expect(left.at(-1)[1]).toBe(-1);
    expect(still).toBe('idle');
  });

  test('a stunned player\'s kit greys out; the ring marks only the player each side is steering', async ({ page }) => {
    await match(page);
    await page.evaluate(() => { const s = window.__scene; s._setPaused(true); s.stunMap.set(s.teamB[4].id, s.time.now + 60000); });
    await frames(page, 3, ``);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      return {
        grey: s.teamB[4].gfx.px.kit.tintTopLeft === 0x8a8a8a,
        ringsA: s.teamA.filter((e) => e.gfx.px.ring.visible).map((e) => e.id),
        ringsB: s.teamB.filter((e) => e.gfx.px.ring.visible).map((e) => e.id),
        activeA: s.activeIdA, activeB: s.activeIdB,
      };
    });
    expect(r.grey).toBe(true);
    expect(r.ringsA).toEqual([r.activeA]);
    expect(r.ringsB).toEqual([r.activeB]);
  });

  test('name plates wear the team colour, with text that stays readable on it', async ({ page }) => {
    await match(page);
    const read = (A, B) => page.evaluate(([A, B]) => {
      const s = window.__scene;
      if (A != null) s.teamColorA = A;
      if (B != null) s.teamColorB = B;
      s._highlightActive();
      const rgba = (c) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},0.92)`;
      const l = (e) => ({ bg: e.label.style.backgroundColor, color: e.label.style.color });
      return { a: l(s.teamA[3]), b: l(s.teamB[3]), wantA: rgba(s.teamColorA), wantB: rgba(s.teamColorB) };
    }, [A, B]);
    // Whatever the teams are, each plate is its own team's colour.
    const r0 = await read(null, null);
    expect(r0.a.bg).toBe(r0.wantA);
    expect(r0.b.bg).toBe(r0.wantB);
    expect(r0.a.bg).not.toBe(r0.b.bg);
    // A very light kit gets dark text, a very dark one white.
    const r1 = await read(0xf5f5f5, 0x10204a);
    expect(r1.a.color).toBe('#14142b');
    expect(r1.b.color).toBe('#ffffff');
    // Stunned players keep their team's plate (only the kit greys out).
    await page.evaluate(() => { const s = window.__scene; s._setPaused(true); s.stunMap.set(s.teamA[3].id, s.time.now + 60000); s._highlightActive(); });
    const stunned = await page.evaluate(() => window.__scene.teamA[3].label.style.backgroundColor);
    expect(stunned).toBe(r1.wantA);
  });

  test('a tired player shows a sweat drop, an exhausted one two, and it goes when they recover', async ({ page }) => {
    await match(page);
    const level = (pct) => page.evaluate(async (pct) => {
      const s = window.__scene; s._setPaused(true);
      const e = s.teamA[6], rival = s.teamB[6];
      for (const [role, en] of [['A', e], ['B', rival]]) { const st = s._statsFor(role, en.id); st.stamina = st.maxStamina * pct / 100; }
      for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
      const d = (en) => en.gfx.px.drops.map((x) => x.visible);
      return { mine: d(e), rival: d(rival), y: e.gfx.px.drops[0].y, alpha: e.gfx.px.drops[0].alpha };
    }, pct);
    const fine = await level(100);
    expect(fine.mine).toEqual([false, false]);
    expect(fine.rival).toEqual([false, false]);
    const tired = await level(30);
    expect(tired.mine).toEqual([true, false]);
    expect(tired.rival).toEqual([true, false]); // the rival's flagging shows too
    expect(tired.y).toBeGreaterThan(-16);       // trickling down beside the head
    expect(tired.y).toBeLessThan(0);
    expect(tired.alpha).toBeGreaterThan(0);
    expect(tired.alpha).toBeLessThanOrEqual(1);
    expect((await level(10)).mine).toEqual([true, true]);
    expect((await level(60)).mine).toEqual([false, false]); // fresh legs / recovered
  });

  test('the in-game team panel marks tired players with drops, on both sides', async ({ page }) => {
    await match(page);
    await page.evaluate(() => {
      const s = window.__scene;
      const set = (role, i, pct) => { const e = (role === 'A' ? s.teamA : s.teamB)[i]; const st = s._statsFor(role, e.id); st.stamina = st.maxStamina * pct / 100; return e.id; };
      window.__ids = { a: set('A', 3, 30), a2: set('A', 4, 10), b: set('B', 3, 20) };
    });
    await page.click('#sub-button');
    await page.waitForFunction(() => window.__scene.teamPanelOpen === true, { timeout: 3000 });
    const count = (id) => page.evaluate((id) => document.querySelector(`#sub-list-inner .slot-pin[data-roster-id="${id}"] .pin-sweat`)?.textContent.length ?? 0, id);
    const ids = await page.evaluate(() => window.__ids);
    expect(await count(ids.a)).toBe(2);   // one 💧 (a surrogate pair is 2 chars)
    expect(await count(ids.a2)).toBe(4);  // exhausted: two
    await page.evaluate(() => document.querySelectorAll('#sub-list-inner .slot-pin[data-roster-id]').length);
    const others = await page.evaluate((ids) => [...document.querySelectorAll('#sub-list-inner .slot-pin[data-roster-id]')].filter((p) => ![ids.a, ids.a2].includes(p.dataset.rosterId) && p.querySelector('.pin-sweat')).length, ids);
    expect(others).toBe(0);               // rested players have none
    // The rival's view shows theirs.
    await page.click('#sub-panel-side-tabs [data-side="rival"]');
    expect(await count(ids.b)).toBe(2);
  });

  test('the ball spins as it rolls', async ({ page }) => {
    await match(page);
    await page.evaluate(() => { const s = window.__scene; s._setPaused(true); window.__ballFrames = new Set(); });
    await frames(page, 20, `s.matter.body.setPosition(s.ball,{x:s.ball.position.x+3,y:s.ball.position.y}); s._drawBall(s.ball.position.x,s.ball.position.y,0); window.__ballFrames.add(s.ballGfx.frame.name);`);
    const n = await page.evaluate(() => window.__ballFrames.size);
    expect(n).toBeGreaterThanOrEqual(3);
  });
});
