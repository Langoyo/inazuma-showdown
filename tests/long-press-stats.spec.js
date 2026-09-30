import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

// Regression tests for replacing "tap the same armed pin/card twice" with a
// press-and-hold gesture to view a player's stats (see _armPressGestures in
// GameScene.js). A quick tap on an already-armed selection now cancels the
// arm instead of opening stats — viewing stats no longer depends on arm
// state at all.

async function longPress(page, locator, ms = 650) {
  // Centred rather than scrollIntoViewIfNeeded: a pin just inside the
  // viewport's bottom edge counts as "visible" but sits under the fixed
  // Confirm squad bar, so the press would land on that button instead.
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

const statsShown = (page) => page.evaluate(() => document.getElementById('player-stat-panel').style.display === 'block');
const closeStats = (page) => page.evaluate(() => { document.getElementById('player-stat-panel').style.display = 'none'; });

test.describe('press and hold to view stats (squad editor)', () => {
  test('a quick tap on an armed pin cancels the arm, not shows stats', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');
    const pin = page.locator('#formation-pitch .slot-pin:not(.empty)').first();

    await pin.click();
    expect(await page.evaluate(() => window.__scene._squadSel)).not.toBeNull();
    expect(await statsShown(page)).toBe(false);

    await pin.click();
    expect(await page.evaluate(() => window.__scene._squadSel)).toBeNull();
    expect(await statsShown(page)).toBe(false);
  });

  test('holding a pin shows its player\'s stats without arming or disarming it', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');
    const pin = page.locator('#formation-pitch .slot-pin:not(.empty)').first();

    const selBefore = await page.evaluate(() => window.__scene._squadSel);
    await longPress(page, pin);
    expect(await statsShown(page)).toBe(true);
    // Arm state is exactly what it was before the hold — long-press is a
    // separate action, not a third branch of the tap state machine.
    expect(await page.evaluate(() => window.__scene._squadSel)).toEqual(selBefore);
    await closeStats(page);
  });

  test('holding a search-list card shows stats without placing or arming it', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('button[data-view="players"]');
    const card = page.locator('#squad-pick-list .pick-card').first();
    const name = await card.locator('.pick-name').textContent();

    await longPress(page, card);
    expect(await statsShown(page)).toBe(true);
    const shownName = await page.locator('#player-stat-panel').innerText();
    expect(shownName).toContain(name.trim());
    // Nothing got armed by the hold — the squad is untouched.
    expect(await page.evaluate(() => window.__scene._squadSel)).toBeNull();
    expect(await page.evaluate(() => window.__scene.squadSlots.filter(Boolean).length)).toBe(0);
  });

  test('a bench spot armed, then long-pressed, is unaffected by the hold', async ({ page }) => {
    // Combines the two: arm a bench spot (a real, common flow — see the
    // bench-slots tests elsewhere), then hold it — should show stats for
    // whoever is there without losing the arm.
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');
    const benchPin = page.locator('#bench-strip .bench-pin:not(.empty)').first();

    await benchPin.click();
    const armed = await page.evaluate(() => window.__scene._squadSel);
    expect(armed).not.toBeNull();

    await longPress(page, benchPin);
    expect(await statsShown(page)).toBe(true);
    expect(await page.evaluate(() => window.__scene._squadSel)).toEqual(armed);
  });
});

test.describe('press and hold to view stats (in-match team panel)', () => {
  test('a quick tap on an armed pin cancels the arm; holding shows stats instead', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);
    await page.click('#sub-button');
    await page.waitForFunction(() => window.__scene.teamPanelOpen === true, { timeout: 2000 });

    const pin = page.locator('#sub-list-inner .slot-pin[data-roster-id]').first();
    await pin.click();
    expect(await page.evaluate(() => window.__scene.subSel)).not.toBeNull();

    await pin.click();
    expect(await page.evaluate(() => window.__scene.subSel)).toBeNull();
    expect(await statsShown(page)).toBe(false);

    await longPress(page, pin);
    expect(await statsShown(page)).toBe(true);
    // A hold never armed a substitution/reposition either.
    expect(await page.evaluate(() => window.__scene.subSel)).toBeNull();
  });
});

test.describe('info popup mentions the new gesture', () => {
  test('"Building your squad" explains press-and-hold, not the old double-tap', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.locator('.info-icon[data-info-title="Building your squad"]').click();
    await expect(page.locator('#info-modal')).toBeVisible();
    const body = await page.locator('#info-modal-body').textContent();
    expect(body).toMatch(/press and hold/i);
    expect(body).not.toMatch(/tap.*twice|twice.*tap/i);
    await page.click('#info-modal-close');
  });
});
