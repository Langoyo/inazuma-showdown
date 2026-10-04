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

  test('the ball spins as it rolls', async ({ page }) => {
    await match(page);
    await page.evaluate(() => { const s = window.__scene; s._setPaused(true); window.__ballFrames = new Set(); });
    await frames(page, 20, `s.matter.body.setPosition(s.ball,{x:s.ball.position.x+3,y:s.ball.position.y}); s._drawBall(s.ball.position.x,s.ball.position.y,0); window.__ballFrames.add(s.ballGfx.frame.name);`);
    const n = await page.evaluate(() => window.__ballFrames.size);
    expect(n).toBeGreaterThanOrEqual(3);
  });
});
