import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

test.describe('team panel — rival formation view', () => {
  test('switching to "Rival Team" shows their lineup read-only, not the sub/swap flow', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    await page.click('#sub-button');
    await page.waitForFunction(() => window.__scene.teamPanelOpen === true, { timeout: 2000 });

    // Starts on "Your Team": the pitch shown is your own side's team.
    const myRole = await page.evaluate(() => window.__scene.role);
    const beforeIds = await page.evaluate((role) => {
      const s = window.__scene;
      const team = role === 'A' ? s.teamA : s.teamB;
      return team.map((e) => e.id).sort();
    }, myRole);
    const pitchIdsBefore = await page.locator('#sub-list-inner .slot-pin[data-roster-id]').evaluateAll(
      (els) => els.map((el) => el.dataset.rosterId).sort()
    );
    expect(pitchIdsBefore).toEqual(beforeIds.map(String).sort());

    await page.click('#sub-panel-side-tabs .sub-panel-side-tab[data-side="rival"]');
    await page.waitForTimeout(100);

    // Formation presets disappear entirely — they'd change your own
    // formation, which means nothing while looking at the rival's side.
    await expect(page.locator('#formation-preset-btns')).toBeHidden();
    await expect(page.locator('#sub-panel-state')).toHaveText(/read-only/);

    // The pitch now shows the *other* role's team.
    const rivalIds = await page.evaluate((role) => {
      const s = window.__scene;
      const oppRole = role === 'A' ? 'B' : 'A';
      const team = oppRole === 'A' ? s.teamA : s.teamB;
      return team.map((e) => e.id).sort();
    }, myRole);
    const pitchIdsAfter = await page.locator('#sub-list-inner .slot-pin[data-roster-id]').evaluateAll(
      (els) => els.map((el) => el.dataset.rosterId).sort()
    );
    expect(pitchIdsAfter).toEqual(rivalIds.map(String).sort());

    // A quick tap on a rival pin or bench pin does nothing: no stats, and no
    // sub selection (which would let a rival pin pair with one of your own).
    // Their stats open on a press and hold, like everywhere else.
    const panelOpen = () => page.evaluate(() => document.getElementById('player-stat-panel').style.display === 'block');
    const pin = page.locator('#sub-list-inner .slot-pin[data-roster-id]').first();
    await pin.click();
    await page.waitForTimeout(150);
    expect(await panelOpen()).toBe(false);
    expect(await page.evaluate(() => window.__scene.subSel)).toBeNull();
    const bench = page.locator('#sub-list-inner .bench-pin[data-bench-id]').first();
    if (await bench.count()) {
      await bench.click();
      await page.waitForTimeout(150);
      expect(await panelOpen()).toBe(false);
    }
    // Holding opens that player's stats, still without arming a selection.
    const rosterId = await pin.getAttribute('data-roster-id');
    const hold = async (loc, ms = 650) => {
      const box = await loc.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up();
    };
    await hold(pin);
    await page.waitForTimeout(150);
    expect(await panelOpen()).toBe(true);
    await expect(page.locator('#player-stat-panel')).toContainText(await page.evaluate((id) => { const p = window.__scene.rosterAll.find((r) => r.id === id); return p.nickname || p.name; }, rosterId));
    expect(await page.evaluate(() => window.__scene.subSel)).toBeNull();
    await expect(page.locator('#sub-panel-state')).toContainText('Press and hold');
    // A hold that wanders off the pin (a scroll) opens nothing.
    await page.click('#player-stat-panel button');
    const box = await pin.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 40, { steps: 4 });
    await page.waitForTimeout(650); await page.mouse.up();
    expect(await panelOpen()).toBe(false);

    // Switching back to "Your Team" restores the normal editable view.
    await page.click('#sub-panel-side-tabs .sub-panel-side-tab[data-side="me"]');
    await page.waitForTimeout(100);
    await expect(page.locator('#formation-preset-btns')).toBeVisible();
    expect(await page.evaluate(() => window.__scene.subPanelSide)).toBe('me');
  });

  test('reopening the panel always resets back to "Your Team"', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    await page.click('#sub-button');
    await page.waitForFunction(() => window.__scene.teamPanelOpen === true, { timeout: 2000 });
    await page.click('#sub-panel-side-tabs .sub-panel-side-tab[data-side="rival"]');
    await page.waitForTimeout(100);

    await page.click('#sub-cancel-btn');
    await page.waitForFunction(() => window.__scene.teamPanelOpen === false, { timeout: 2000 });
    await page.click('#sub-button');
    await page.waitForFunction(() => window.__scene.teamPanelOpen === true, { timeout: 2000 });

    expect(await page.evaluate(() => window.__scene.subPanelSide)).toBe('me');
    await expect(page.locator('#formation-preset-btns')).toBeVisible();
  });
});
