import { test, expect } from '@playwright/test';
import { waitForRosterLoaded } from './helpers.js';

// The profile is a collapsed <details> under the formation in the squad editor.
async function openProfile(page) {
  await page.locator('#profile-section summary').scrollIntoViewIfNeeded();
  await page.click('#profile-section summary');
  await expect(page.locator('#profile-section')).toHaveAttribute('open', '');
}

test.describe('team names on the scoreboard', () => {
  test('a solo match shows your team name beside your goals, and "Rival" for the AI; the score text is untouched', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.fill('#squad-team-name', 'Raimon');
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    await page.waitForFunction(() => window.__scene?.matchStarted === true, { timeout: 10000 });

    await expect(page.locator('#score-name-a')).toHaveText('Raimon');
    await expect(page.locator('#score-name-b')).toHaveText('Rival');
    await expect(page.locator('#scoreboard .score')).toHaveText('0 - 0');
  });

  test('with no team name typed it falls back to the profile player name', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.evaluate(() => window.__scene._profileSetPlayerName('Axel'));
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    await page.waitForFunction(() => window.__scene?.matchStarted === true, { timeout: 10000 });
    await expect(page.locator('#score-name-a')).toHaveText('Axel');
  });

  test('with neither a team name nor a profile name it says "You"', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    await page.waitForFunction(() => window.__scene?.matchStarted === true, { timeout: 10000 });
    await expect(page.locator('#score-name-a')).toHaveText('You');
  });
});

test.describe('profile', () => {
  test('lives below the formation, pitch and save row, and folds away with the Formation toggle', async ({ page }) => {
    await waitForRosterLoaded(page);
    const y = async (sel) => (await page.locator(sel).boundingBox()).y;
    const profileY = await y('#profile-section summary');
    expect(profileY).toBeGreaterThan(await y('#formation-select'));
    expect(profileY).toBeGreaterThan(await y('#formation-pitch'));
    expect(profileY).toBeGreaterThan(await y('#squad-save-row'));

    // Collapsed by default, so it doesn't push the pitch around until asked.
    await expect(page.locator('#profile-name')).toBeHidden();
    await openProfile(page);
    await expect(page.locator('#profile-name')).toBeVisible();

    await page.click('button[data-view="formation"]');
    await expect(page.locator('#profile-section')).toBeHidden();
  });

  test('saves the current squad, lists it, and loads it back after the editor changes', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');
    await page.fill('#squad-team-name', 'Zeus XI');
    const saved = await page.evaluate(() => ({ slots: [...window.__scene.squadSlots], formation: window.__scene.chosenFormation }));

    await openProfile(page);
    await page.click('#profile-save-current-btn');
    await expect(page.locator('.profile-squad')).toHaveCount(1);
    await expect(page.locator('.profile-squad input')).toHaveValue('Zeus XI');

    // Saving under the same name updates instead of stacking a duplicate.
    await page.click('#profile-save-current-btn');
    await expect(page.locator('.profile-squad')).toHaveCount(1);

    await page.click('#pitch-randomize-btn'); // change the editor
    await page.locator('.profile-squad button', { hasText: 'Load' }).click();
    await expect(page.locator('#profile-status')).toContainText('Loaded "Zeus XI"');

    const after = await page.evaluate(() => ({ slots: [...window.__scene.squadSlots], formation: window.__scene.chosenFormation }));
    expect(after).toEqual(saved);
    await expect(page.locator('#squad-team-name')).toHaveValue('Zeus XI');
  });

  test('a saved squad can be renamed, updated from the editor, and deleted', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');
    await openProfile(page);
    await page.click('#profile-save-current-btn');

    await page.locator('.profile-squad input').fill('Inazuma Japan');
    await page.locator('.profile-squad input').dispatchEvent('change');
    let profile = await page.evaluate(() => JSON.parse(localStorage.getItem('inazuma-clone:profile:v1')));
    expect(profile.squads[0].name).toBe('Inazuma Japan');

    await page.click('#pitch-randomize-btn');
    const newSlots = await page.evaluate(() => [...window.__scene.squadSlots]);
    await page.locator('.profile-squad button', { hasText: 'Update' }).click();
    profile = await page.evaluate(() => JSON.parse(localStorage.getItem('inazuma-clone:profile:v1')));
    expect(profile.squads[0].slots).toEqual(newSlots);
    expect(profile.squads[0].name).toBe('Inazuma Japan');

    await page.locator('.profile-squad button[title="Delete"]').click();
    await expect(page.locator('.profile-squad')).toHaveCount(0);
    await expect(page.locator('.profile-empty')).toBeVisible();
  });

  test('the player name persists and is written to the downloaded file along with the squads', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');
    await openProfile(page);
    await page.fill('#profile-name', 'Mark Evans');
    await page.locator('#profile-name').dispatchEvent('change');
    await page.click('#profile-save-current-btn');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#profile-download-btn'),
    ]);
    expect(download.suggestedFilename()).toBe('inazuma-profile.json');
    const file = JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(), 'utf8'));
    expect(file.format).toBe('inazuma-profile');
    expect(file.playerName).toBe('Mark Evans');
    expect(file.squads).toHaveLength(1);
    expect(file.squads[0].slots.filter(Boolean)).toHaveLength(11);
  });

  test('importing a file merges squads by name and keeps existing ones', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');
    await page.fill('#squad-team-name', 'Mine');
    await openProfile(page);
    await page.click('#profile-save-current-btn');

    const roster = await page.evaluate(() => window.__scene.rosterAll.slice(0, 11).map((p) => p.id));
    const incoming = {
      format: 'inazuma-profile', version: 1, playerName: 'Imported Hero',
      squads: [{ id: 'x1', name: 'From file', formation: '4-3-3', slots: roster, bench: [], savedAt: 1700000000000 }],
    };
    await page.setInputFiles('#profile-import-file', {
      name: 'inazuma-profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)),
    });

    await expect(page.locator('.profile-squad')).toHaveCount(2);
    await expect(page.locator('#profile-name')).toHaveValue('Imported Hero');
    await expect(page.locator('#profile-status')).toContainText('Imported 1 squad');
  });

  test('a file that is not a profile is rejected without touching what is saved', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');
    await openProfile(page);
    await page.click('#profile-save-current-btn');

    await page.setInputFiles('#profile-import-file', {
      name: 'nope.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": "world"}'),
    });
    await expect(page.locator('#profile-status')).toContainText("Couldn't import");
    await expect(page.locator('.profile-squad')).toHaveCount(1);
  });

  test('a hand-edited file with markup in a squad name is shown as plain text, not run', async ({ page }) => {
    await waitForRosterLoaded(page);
    await openProfile(page);
    const evil = {
      format: 'inazuma-profile', version: 1, playerName: '',
      squads: [{ id: 'e1', name: '<img src=x onerror="window.__pwned=1">', formation: 'nonsense', slots: [], bench: [] }],
    };
    await page.setInputFiles('#profile-import-file', {
      name: 'evil.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(evil)),
    });
    await expect(page.locator('.profile-squad')).toHaveCount(1);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    expect(await page.locator('.profile-squad img').count()).toBe(0);
    // An unknown formation falls back to the default rather than breaking the editor.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('inazuma-clone:profile:v1')));
    expect(stored.squads[0].formation).toBe('4-4-2');
  });
});
