import { test, expect } from '@playwright/test';
import { waitForRosterLoaded, startMatch } from './helpers.js';

test.describe('team panel forces a shared pause', () => {
  test('opening it still pauses solo vs AI (existing behavior)', async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    // Even the host's own click goes through the same one-shot
    // teamPanelRequest flag _applySquadRequests reads every tick (the
    // established pattern for every other input in this game — a
    // substitution or shot request also lands a frame later, not
    // synchronously), so give it a tick to land instead of asserting
    // immediately after the click.
    await page.click('#sub-button');
    await page.waitForFunction(() => window.__scene.paused === true, { timeout: 2000 });
    expect(await page.evaluate(() => window.__scene.teamPanelOpen)).toBe(true);

    await page.click('#sub-cancel-btn');
    await page.waitForFunction(() => window.__scene.paused === false, { timeout: 2000 });
    expect(await page.evaluate(() => window.__scene.teamPanelOpen)).toBe(false);
  });

  test('opening it with a real opponent connected now pauses too, instead of leaving play running', async ({ page }) => {
    // Regression test: this used to be the one case that deliberately did
    // NOT pause (freezing the simulation would've frozen the opponent's
    // match too, back when only the local player's panel mattered). The
    // whole point of the shared team-panel flag is that it's fine now —
    // pausing is host-authoritative and applies to both sides together.
    await waitForRosterLoaded(page);
    await startMatch(page);
    await page.evaluate(() => { window.__scene.net.hasPeer = () => true; });

    await page.click('#sub-button');
    await page.waitForFunction(() => window.__scene.paused === true, { timeout: 2000 });
    expect(await page.evaluate(() =>
      document.getElementById('sub-panel').style.display === 'flex'
    )).toBe(true);
  });

  test("the other side opening their panel forces it open (and paused) here too", async ({ page }) => {
    await waitForRosterLoaded(page);
    await startMatch(page);

    await page.evaluate(() => {
      const s = window.__scene;
      s.net.hasPeer = () => true; s.uiMode = 'multiplayer'; // simulate a connected opponent
      // As if the other player just clicked "Team" and it reached us —
      // real delivery goes through sendInput/onInput; this is the same
      // one-shot flag _applySquadRequests reads either way.
      s.remoteInput.teamPanelRequest = 'open';
    });
    await page.waitForFunction(() => window.__scene.teamPanelOpen === true, { timeout: 2000 });

    const state = await page.evaluate(() => ({
      paused: window.__scene.paused,
      panelVisible: document.getElementById('sub-panel').style.display === 'flex',
    }));
    expect(state.paused).toBe(true);
    expect(state.panelVisible).toBe(true);
  });
});
