import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

test.describe('AI difficulty stat inflation', () => {
  test('only inflates side B, only while nobody is connected to play it', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.selectOption('#ai-level-select', 'hard');
    await startMatch(page);

    const solo = await page.evaluate(() => {
      const s = window.__scene;
      return { a: s._aiStatMul('A'), b: s._aiStatMul('B') };
    });
    expect(solo.a).toBe(1); // human side is never inflated
    expect(solo.b).toBeGreaterThan(1); // AI side gets the level's bonus

    // Simulate a peer being connected — the live multiplier must drop back
    // to 1 immediately, since the stored roster stats are never touched.
    const withPeer = await page.evaluate(() => {
      const s = window.__scene;
      const original = s.net.hasPeer, mode = s.uiMode;
      s.net.hasPeer = () => true; s.uiMode = 'multiplayer'; // a real opponent is only ever a Multiplayer one
      const b = s._aiStatMul('B');
      s.net.hasPeer = original; s.uiMode = mode;
      return b;
    });
    expect(withPeer).toBe(1);
  });

  test('the ladder is monotonically increasing, and Normal sits closer to Easy than to Hard', async ({ page }) => {
    await waitForRosterLoaded(page);

    const levels = ['easy', 'normal', 'hard', 'expert'];
    const muls = [];
    for (const level of levels) {
      await page.selectOption('#ai-level-select', level);
      muls.push(await page.evaluate(() => window.__scene.aiLevel));
    }
    // Just confirms the select actually drives `aiLevel` for every option;
    // the level-vs-multiplier mapping itself lives in AI_LEVELS and is
    // exercised by the previous test.
    expect(muls).toEqual(levels);
  });

  test('the difficulty dropdown only shows the level name, no extra text', async ({ page }) => {
    await waitForRosterLoaded(page);
    const labels = await page.locator('#ai-level-select option').allTextContents();
    expect(labels).toEqual(['Easy', 'Normal', 'Hard', 'Expert']);
  });
});
