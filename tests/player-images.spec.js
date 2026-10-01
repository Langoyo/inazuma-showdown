import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

// Regression coverage for the pixel-art portraits added by
// scripts/map-player-images.mjs: every roster player should carry an
// `image` field pointing at a real, servable file, and the avatar chips
// across the UI (list card, formation pin, stat sheet, duel card) should
// show that portrait instead of the flat colour-and-initials circle —
// while the on-pitch match sprites (Phaser circles) stay untouched.

test.describe('roster carries a real portrait for (almost) every player', () => {
  test('image fields point at files that actually exist under /player_images/', async ({ page }) => {
    await waitForRosterLoaded(page);
    const result = await page.evaluate(async () => {
      const s = window.__scene;
      const withImage = s.rosterAll.filter((p) => p.image);
      // Spot-check a spread of them against the real server, not all 5000+.
      const sample = withImage.filter((_, i) => i % 400 === 0).slice(0, 15);
      const checks = await Promise.all(sample.map(async (p) => {
        const res = await fetch(p.image);
        return res.ok;
      }));
      return {
        total: s.rosterAll.length,
        withImage: withImage.length,
        sampleOk: checks.every(Boolean),
        sampleSize: checks.length,
      };
    });
    expect(result.sampleSize).toBeGreaterThan(5);
    expect(result.sampleOk).toBe(true);
    // Not asserting 100% here — the mapping script itself is what
    // guarantees coverage (and aborts if it can't reach it); this is a
    // smoke test that the field and the files it points at are real.
    expect(result.withImage / result.total).toBeGreaterThan(0.95);
  });
});

test.describe('portraits show up in the UI instead of colour+initials', () => {
  test('a search-list card shows the portrait as a background-image', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('button[data-view="players"]');
    const withImage = await page.evaluate(() => window.__scene.rosterAll.find((p) => p.image?.startsWith('/')));
    await page.fill('#squad-search', withImage.name);
    await page.waitForTimeout(200);
    // The same name can match a few cards (one per game), in rating order —
    // the one we picked is among them, wearing its own portrait.
    const avs = page.locator('#squad-pick-list .pick-card .av');
    const bgs = await avs.evaluateAll((els) => els.map((el) => ({ bg: getComputedStyle(el).backgroundImage, text: el.textContent.trim() })));
    const mine = bgs.find((b) => b.bg.includes(withImage.image.split('/').pop()));
    expect(mine).toBeTruthy();
    // No leftover initials text sitting on top of the portrait.
    expect(mine.text).toBe('');
  });

  test('a formation pin shows the portrait, keeping the pin token itself circular', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');
    const pin = page.locator('#formation-pitch .slot-pin:not(.empty)').first();
    const shapes = await pin.evaluate((el) => ({
      pinRadius: getComputedStyle(el).borderRadius,
      avatarBg: getComputedStyle(el.querySelector('.pin-avatar')).backgroundImage,
      avatarRadius: getComputedStyle(el.querySelector('.pin-avatar')).borderRadius,
    }));
    expect(shapes.pinRadius).toBe('50%'); // the pin token itself is still a circle
    expect(shapes.avatarBg).toMatch(/player_images|url\("https:/); // the face inside it is a picture
    expect(['0px', '']).toContain(shapes.avatarRadius); // square frame, not cropped to a circle
  });

  test('the stat sheet header shows the portrait', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');
    const p = await page.evaluate(() => {
      const s = window.__scene;
      const id = s.squadSlots.find(Boolean);
      return s.rosterAll.find((r) => r.id === id);
    });
    await page.evaluate((pl) => window.__scene._showPlayerStats(pl), p);
    await page.waitForTimeout(150);
    const bg = await page.locator('#player-stat-panel .pin-avatar').evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain(p.image.split('/').pop());
  });

  test('the in-match team panel shows portraits too', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    await page.click('#sub-button');
    await page.waitForFunction(() => window.__scene.teamPanelOpen === true, { timeout: 2000 });
    // Pixel portraits, or the official art for the few without one yet.
    const bgs = await page.locator('#sub-list-inner .slot-pin[data-roster-id] .pin-avatar').evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundImage));
    expect(bgs.length).toBeGreaterThan(0);
    for (const bg of bgs) expect(bg).toMatch(/player_images|url\("https:/);
  });

  test('a duel card shows both players\' portraits', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const shown = await page.evaluate(() => {
      const s = window.__scene;
      const eA = s.teamA.find((e) => e.slot !== 0 && e.body);
      const eB = s.teamB.find((e) => e.slot !== 0 && e.body);
      s.confrontation = { type: 'duel', attackerRole: 'A', defenderRole: 'B', attackerId: eA.id, defenderId: eB.id,
        deadline: s.time.now + 1, attackerChoice: 'normal', defenderChoice: 'normal', attackerLocked: true, pending: null };
      s._prepareConfrontReveal(s.time.now);
      s._renderDuelReveal(s.confrontation.reveal);
      const pA = s.rosterAll.find((r) => r.id === eA.id), pB = s.rosterAll.find((r) => r.id === eB.id);
      return { imgA: pA.image, imgB: pB.image };
    });
    const bgA = await page.locator('#duel-card-a .duel-portrait').evaluate((el) => getComputedStyle(el).backgroundImage);
    const bgD = await page.locator('#duel-card-d .duel-portrait').evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bgA).toContain(shown.imgA.split('/').pop());
    expect(bgD).toContain(shown.imgB.split('/').pop());
  });
});

test.describe('graceful fallback when a player has no portrait', () => {
  test('falls back to the colour+initials chip exactly as before', async ({ page }) => {
    await waitForRosterLoaded(page);
    const result = await page.evaluate(() => {
      const s = window.__scene;
      const p = { ...s.rosterAll.find(Boolean), image: undefined, nickname: 'Zeta Zed' };
      return s._avatarFill(p, '#3399ff');
    });
    expect(result.style).toBe('background:#3399ff;');
    expect(result.inner).toBe('ZZ');
  });

  test('a null player (defensive case) does not throw and shows a placeholder', async ({ page }) => {
    await waitForRosterLoaded(page);
    const result = await page.evaluate(() => window.__scene._avatarFill(null, '#999999'));
    expect(result.style).toBe('background:#999999;');
    expect(result.inner).toBe('?');
  });
});

test.describe('live-match sprites are untouched', () => {
  test('players on the pitch during a match are still plain coloured circles, not portraits', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const anyImageOnCanvas = await page.evaluate(() => {
      const s = window.__scene;
      // Every teamA/teamB entry's on-pitch representation is a Phaser
      // Graphics circle (e.fx) — there is no texture/image object at all
      // for it to have swapped to.
      return s.teamA.every((e) => e.gfx && e.gfx.type === 'Arc') && s.teamB.every((e) => e.gfx && e.gfx.type === 'Arc');
    });
    expect(anyImageOnCanvas).toBe(true);
  });
});
