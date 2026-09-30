import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

// Jump to the last moment of the second half with the given score.
async function endOfSecondHalf(page, a, b) {
  await page.evaluate(({ a, b }) => {
    const s = window.__scene;
    s.score = { a, b };
    document.querySelector('#scoreboard .score').textContent = `${a} - ${b}`;
    s.matchClock.half = 2;
    s.matchClock.secondsRemaining = 0.05;
  }, { a, b });
}

test.describe('golden-goal overtime', () => {
  test('a tie at full time goes to overtime instead of ending, with a break first', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    await endOfSecondHalf(page, 1, 1);
    await page.waitForFunction(() => window.__scene.matchClock.overtime === true, { timeout: 10000 });

    const atStart = await page.evaluate(() => ({
      ended: window.__scene.matchClock.ended,
      paused: window.__scene.paused,
      banner: window.__scene.confrontResult?.title,
    }));
    expect(atStart.ended).toBe(false);
    expect(atStart.paused).toBe(true);
    expect(atStart.banner).toMatch(/Overtime/);
    await expect(page.locator('#match-clock')).toContainText('Overtime');
    await expect(page.locator('#fulltime-panel')).toBeHidden();

    // After the break it plays on, the overtime clock counting up.
    await page.waitForFunction(() => window.__scene.paused === false, { timeout: 6000 });
    await page.waitForFunction(() => window.__scene.matchClock.otElapsed > 0.5, { timeout: 6000 });
    expect(await page.evaluate(() => window.__scene.matchClock.ended)).toBe(false);
  });

  test('the first goal in overtime ends the match', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    await endOfSecondHalf(page, 0, 0);
    await page.waitForFunction(() => window.__scene.matchClock.overtime === true && window.__scene.paused === false, { timeout: 10000 });

    await page.evaluate(() => window.__scene._onGoal('a'));
    await page.waitForFunction(() => window.__scene.matchClock.ended === true, { timeout: 8000 });
    await expect(page.locator('#fulltime-panel')).toBeVisible();
    await expect(page.locator('#fulltime-score')).toHaveText('1 - 0');
    await expect(page.locator('#fulltime-verdict')).toHaveText('You win in overtime!');
  });

  test('a match that is not level at full time just ends', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    await endOfSecondHalf(page, 2, 1);
    await page.waitForFunction(() => window.__scene.matchClock.ended === true, { timeout: 10000 });
    expect(await page.evaluate(() => !!window.__scene.matchClock.overtime)).toBe(false);
    await expect(page.locator('#fulltime-verdict')).toHaveText('You win!');
  });

  test('a league fixture keeps its draw — no overtime', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    await page.evaluate(() => {
      const s = window.__scene;
      s._tournamentPendingFixture = { kind: 'league', fixtureIdx: 0, a: 'me', b: 'x' };
      s._recordTournamentResult = () => {}; // no real tournament behind this match
    });
    await endOfSecondHalf(page, 1, 1);
    await page.waitForFunction(() => window.__scene.matchClock.ended === true, { timeout: 10000 });
    expect(await page.evaluate(() => !!window.__scene.matchClock.overtime)).toBe(false);
    await expect(page.locator('#fulltime-verdict')).toHaveText('Draw');
  });
});
