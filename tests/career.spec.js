import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, waitForRosterAtModeSelect, startMatch } from './helpers.js';

// The profile keeps a career record (W/D/L, goals, trophies, top scorers),
// and a tournament keeps your top scorers.

const readRecord = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('inazuma-clone:profile:v1') || 'null')?.record);

async function finishMatch(page, a, b, scorerIdx = []) {
  await page.evaluate(({ a, b, scorerIdx }) => {
    const s = window.__scene;
    scorerIdx.forEach((i) => s._recordGoal('A', s.teamA[i].id));
    s.score = { a, b };
    document.querySelector('#scoreboard .score').textContent = `${a} - ${b}`;
    s._showFullTime();
  }, { a, b, scorerIdx });
}

test.describe('career record', () => {
  test('a finished match lands in the profile record and survives a reload', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    const scorer = await page.evaluate(() => window.__scene.teamA[10].id);
    await finishMatch(page, 2, 1, [10, 10]);
    const rec = await readRecord(page);
    expect(rec).toMatchObject({ played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 1 });
    expect(rec.scorers[scorer]).toBe(2);

    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#squad-pick-list .pick-card').length > 0, { timeout: 15000 });
    await expect(page.locator('#profile-record')).toContainText('1 played · 1W 0D 0L · 2–1 goals');
    await expect(page.locator('#profile-record .profile-top-scorers')).toContainText('(2)');
  });

  test('the downloaded profile carries the record', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    await finishMatch(page, 0, 3);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => window.__scene._profileDownload()),
    ]);
    const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString());
    expect(JSON.parse(text).record).toMatchObject({ played: 1, lost: 1, goalsAgainst: 3 });
  });

  test('importing an old file gives zeros; a hand-edited record is cleaned', async ({ page }) => {
    await waitForRosterLoaded(page);
    const clean = await page.evaluate(() => {
      const s = window.__scene;
      return {
        old: s._cleanProfile({ squads: [] }).record,
        bad: s._cleanProfile({ squads: [], record: { played: -4, won: 2.7, lost: 'x', goalsFor: 1e12, scorers: { a: 3, b: -1, c: 'z' }, storiesCompleted: ['ie1', 'ie1', 5] } }).record,
      };
    });
    expect(clean.old).toMatchObject({ played: 0, won: 0, scorers: {}, storiesCompleted: [] });
    expect(clean.bad).toMatchObject({ played: 0, won: 2, lost: 0, goalsFor: 1e6, scorers: { a: 3 }, storiesCompleted: ['ie1'] });
  });

  test('importing keeps whichever record has more matches behind it', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.evaluate(() => localStorage.setItem('inazuma-clone:profile:v1', JSON.stringify({ squads: [], record: { played: 5, won: 5 } })));
    const file = (played) => ({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ squads: [], record: { played, won: 0, lost: played } })) });
    await page.setInputFiles('#profile-import-file', file(2));
    await expect.poll(async () => (await readRecord(page)).played).toBe(5);
    await page.setInputFiles('#profile-import-file', file(9));
    await expect.poll(async () => (await readRecord(page)).played).toBe(9);
  });
});

test.describe('tournament scorers and trophies', () => {
  test('your scorers show under the bracket, and winning it counts a trophy', async ({ page }) => {
    await waitForRosterAtModeSelect(page);
    await page.click('#mode-tournament-btn');
    await page.check('input[name="tournament-size"][value="4"]');
    await page.click('[data-tournament-action="setup-continue"]');
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    for (let round = 0; round < 2; round++) {
      await page.click('[data-tournament-action="play"]');
      await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });
      await finishMatch(page, 2, 0, [10]);
      await page.click('#fulltime-continue-btn');
      await expect(page.locator('#tournament-panel')).toBeVisible({ timeout: 20000 });
    }
    await expect(page.locator('#tournament-scorers')).toContainText('(2)');
    await expect(page.locator('#tournament-body')).toContainText('Champion: You');
    expect((await readRecord(page)).tournamentsWon).toBe(1);
  });
});
