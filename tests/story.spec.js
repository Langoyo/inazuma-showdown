import { test, expect } from '@playwright/test';
import { waitForRosterAtModeSelect } from './helpers.js';

// Story mode: one game's canonical run, rival by rival. Win to move on, lose
// to retry; the squad is locked for the run and the run survives the reload
// every match ends in.

async function openStory(page) {
  await waitForRosterAtModeSelect(page);
  await page.click('#mode-story-btn');
  await expect(page.locator('#story-panel')).toBeVisible();
}
async function finish(page, a, b) {
  await page.evaluate(({ a, b }) => {
    const s = window.__scene;
    s.score = { a, b };
    document.querySelector('#scoreboard .score').textContent = `${a} - ${b}`;
    s._showFullTime();
  }, { a, b });
  await page.click('#fulltime-continue-btn');
  await expect(page.locator('#story-panel')).toBeVisible({ timeout: 20000 });
}

test.describe('story mode', () => {
  test('every run resolves to a full ladder of rivals the roster can field', async ({ page }) => {
    await waitForRosterAtModeSelect(page);
    const runs = await page.evaluate(async () => {
      const { STORY_RUNS } = await import('/src/data/story.js');
      return STORY_RUNS.map((r) => ({ id: r.id, listed: r.steps.length, playable: window.__scene._storySteps(r).length }));
    });
    for (const r of runs) {
      expect(r.playable, `${r.id}: ${r.playable}/${r.listed} steps playable`).toBeGreaterThanOrEqual(5);
      expect(r.playable, `${r.id} has rivals the roster can't field`).toBe(r.listed);
    }
  });

  test('a run is listed per game; IE1 can field Raimon, IE3 has no such team in the roster', async ({ page }) => {
    await openStory(page);
    await expect(page.locator('.story-run')).toHaveCount(6);
    await page.click('[data-story-action="start"][data-run="ie3"]');
    await expect(page.locator('#story-hero-btn')).toBeHidden();
    await page.click('#squad-back-btn');
    await page.click('#mode-story-btn');
    await page.click('[data-story-action="start"][data-run="go2"]');
    await expect(page.locator('#story-hero-btn')).toHaveText('⭐ Play as Chrono Storm (GO2)');
    await page.click('#squad-back-btn');
    await page.click('#mode-story-btn');
    await page.click('[data-story-action="start"][data-run="ie1"]');
    await expect(page.locator('#story-hero-btn')).toHaveText('⭐ Play as Raimon (IE1)');
    await page.click('#story-hero-btn');
    const xi = await page.evaluate(() => window.__scene.squadSlots.filter(Boolean).map((id) => window.__scene.rosterAll.find((p) => p.id === id)));
    expect(xi).toHaveLength(11);
    expect(xi.every((p) => p.team === 'Raimon' && p.game === 'IE1')).toBe(true);
    await expect(page.locator('#squad-team-name')).toHaveValue('Raimon');
    // No rival tab: the opponents come from the story.
    await expect(page.locator('#squad-side-tabs')).toBeHidden();
  });

  test('beating a rival moves the run on after the reload; losing means trying again', async ({ page }) => {
    await openStory(page);
    await page.click('[data-story-action="start"][data-run="ie1"]');
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    await expect(page.locator('.story-step.current')).toContainText('Royal Academy');

    await page.click('[data-story-action="play"]');
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });
    await expect(page.locator('#score-name-b')).toHaveText('Royal Academy');
    await finish(page, 0, 1);
    await expect(page.locator('.story-step.current')).toContainText('Royal Academy');
    await expect(page.locator('[data-story-action="play"]')).toHaveText('Try again: vs Royal Academy');

    await page.click('[data-story-action="play"]');
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });
    await finish(page, 3, 1);
    await expect(page.locator('.story-step.won').first()).toContainText('3–1');
    await expect(page.locator('.story-step.current')).toContainText('Occult');
    await expect(page.locator('.story-head')).toContainText('1/10');
  });

  test('winning the last match completes the run and marks it in the profile', async ({ page }) => {
    await openStory(page);
    await page.click('[data-story-action="start"][data-run="ie2"]');
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    // Skip ahead to the final.
    await page.evaluate(async () => {
      const { getStoryRun } = await import('/src/data/story.js');
      const s = window.__scene;
      const n = s._storySteps(getStoryRun('ie2')).length;
      s.activeStory = { ...s.activeStory, step: n - 1 };
      localStorage.setItem('inazuma-clone:story:v1', JSON.stringify(s.activeStory));
      s._renderStoryPanel();
    });
    await expect(page.locator('.story-step.current')).toContainText('Genesis');
    await page.click('[data-story-action="play"]');
    await page.waitForFunction(() => window.__scene.matchStarted === true, { timeout: 10000 });
    await finish(page, 2, 0);
    await expect(page.locator('.story-complete')).toContainText('Alius Academy complete!');
    const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('inazuma-clone:profile:v1')).record);
    expect(rec.storiesCompleted).toEqual(['ie2']);
    await page.click('[data-story-action="end"]');
    await expect(page.locator('.story-run').filter({ hasText: 'IE2' })).toContainText('✓ completed');
  });
});
