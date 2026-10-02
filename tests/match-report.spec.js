import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, waitForRosterAtModeSelect, startMatch } from './helpers.js';

// The full-time screen shows a match report (scorers, a stat table, an MVP)
// and stays up until you choose: Rematch (vs AI), back to the tournament, or
// the menu.

test.describe('match report', () => {
  test('goals, stats and the MVP from the match show at full time', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const { scorer, keeper } = await page.evaluate(() => {
      const s = window.__scene;
      const fw = s.teamA[s.teamA.length - 1].id;
      s.matchStats.elapsedS = s.halfLengthS; // half way: the 45th minute
      s._recordGoal('A', fw);
      s.score.a = 1;
      document.querySelector('#scoreboard .score').textContent = '1 - 0';
      s._stat('A', 'shots', 3);
      s._stat('A', 'onTarget', 2);
      s._stat('B', 'saves', 1, s.gkIdB);
      s.matchStats.A.possMs = 3000; s.matchStats.B.possMs = 1000;
      s._showFullTime();
      return { scorer: s._statsFor('A', fw).name, keeper: s._statsFor('B', s.gkIdB).name };
    });
    const report = page.locator('#fulltime-report');
    await expect(page.locator('#fulltime-panel')).toBeVisible();
    await expect(report.locator('.ft-goals')).toContainText(`45' ${scorer}`);
    await expect(report.locator('.ft-table')).toContainText('3 (2)');
    await expect(report.locator('.ft-table')).toContainText('75%');
    // A goal (3) outweighs a save (2).
    await expect(report.locator('.ft-mvp-name')).toHaveText(scorer);
    await expect(report.locator('.ft-mvp-line')).toHaveText('1 goal');
    expect(keeper).toBeTruthy();
    // No auto-return any more: you choose.
    await expect(page.locator('#fulltime-rematch-btn')).toBeVisible();
    await expect(page.locator('#fulltime-continue-btn')).toBeHidden();
  });

  test('a duel decided on the pitch is counted for the side that won it', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const counts = await page.evaluate(() => {
      const s = window.__scene;
      const a = s.teamA[5], d = s.teamB[5];
      s.confrontation = {
        type: 'duel', attackerRole: 'A', defenderRole: 'B', attackerId: a.id, defenderId: d.id,
        pending: { aWins: false, aTN: 'Normal', dTN: 'Normal', fx: null, aName: 'x', dName: 'y' },
      };
      s._applyConfrontOutcome(s.time.now);
      return { a: s.matchStats.A.duelsWon, b: s.matchStats.B.duelsWon, line: s.matchStats.players[d.id]?.duelsWon };
    });
    expect(counts).toEqual({ a: 0, b: 1, line: 1 });
  });

  test('Rematch reloads straight into the same two squads', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.selectOption('#ai-level-select', 'hard');
    await startMatch(page);
    const before = await page.evaluate(() => ({ a: window.__scene.teamA.map((e) => e.id), b: window.__scene.teamB.map((e) => e.id) }));
    await page.evaluate(() => window.__scene._showFullTime());
    await page.click('#fulltime-rematch-btn');
    await page.waitForFunction(() => window.__scene?.matchStarted === true, { timeout: 20000 });
    const after = await page.evaluate(() => ({ a: window.__scene.teamA.map((e) => e.id), b: window.__scene.teamB.map((e) => e.id), level: window.__scene.aiLevel }));
    expect(after.a).toEqual(before.a);
    expect(after.b).toEqual(before.b);
    expect(after.level).toBe('hard');
    await expect(page.locator('#landing-panel')).toBeHidden();
    // Used once: a plain reload after that is a fresh start again.
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#squad-pick-list .pick-card').length > 0, { timeout: 15000 });
    expect(await page.evaluate(() => window.__scene.matchStarted)).toBe(false);
  });

  test('multiplayer has no Rematch button', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    await page.evaluate(() => { window.__scene.uiMode = 'multiplayer'; window.__scene._showFullTime(); });
    await expect(page.locator('#fulltime-rematch-btn')).toBeHidden();
    await expect(page.locator('#fulltime-menu-btn')).toBeVisible();
  });

  test('a tournament fixture offers "Back to the tournament", which reopens the bracket', async ({ page }) => {
    await waitForRosterAtModeSelect(page);
    await page.click('#mode-tournament-btn');
    await page.click('[data-tournament-action="setup-continue"]');
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    await page.click('[data-tournament-action="play"]');
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });
    await page.evaluate(() => { document.querySelector('#scoreboard .score').textContent = '2 - 0'; window.__scene._showFullTime(); });
    await expect(page.locator('#fulltime-rematch-btn')).toBeHidden();
    await page.click('#fulltime-continue-btn');
    await expect(page.locator('#tournament-panel')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#landing-panel')).toBeHidden();
  });
});
