import { test, expect } from '@playwright/test';
import { waitForRosterLoaded } from './helpers.js';

// The Browse Players filters are linked: each dropdown only offers what the
// other two leave. Games/teams are picked from the loaded roster in-page, so
// these don't depend on particular names.

async function openBrowse(page) {
  await waitForRosterLoaded(page);
  await page.click('button[data-view="players"]');
}
// The <select>s are hidden behind type-to-search boxes now but still hold the
// value; drive them directly where a test is about the linking, not the box.
const choose = (page, id, value) => page.evaluate(({ id, value }) => {
  const el = document.getElementById(id);
  el.value = value;
  el.dispatchEvent(new Event('change'));
}, { id: id.replace('#', ''), value });
const optionValues = (page, id) => page.evaluate((id) => [...document.getElementById(id).options].map((o) => o.value).filter(Boolean), id);

test.describe('linked Browse Players filters', () => {
  test('picking a game leaves only that game\'s teams, as plain options', async ({ page }) => {
    await openBrowse(page);
    const { game, otherOnly } = await page.evaluate(() => {
      const r = window.__scene.rosterAll;
      const teamsIn = (g) => new Set(r.filter((p) => p.game === g).flatMap((p) => window.__scene._teamsOf(p)));
      const games = [...new Set(r.map((p) => p.game))];
      for (const g of games) {
        const mine = teamsIn(g);
        const other = [...new Set(r.filter((p) => p.game !== g).flatMap((p) => window.__scene._teamsOf(p)))].find((t) => !mine.has(t));
        if (other) return { game: g, otherOnly: other };
      }
      return {};
    });
    await choose(page, '#squad-game-filter', game);

    const teams = await optionValues(page, 'squad-team-filter');
    const validArr = await page.evaluate((g) => [...new Set(window.__scene.rosterAll.filter((p) => p.game === g).flatMap((p) => window.__scene._teamsOf(p)))], game);
    expect(teams.length).toBe(validArr.length);
    expect(teams.every((t) => validArr.includes(t))).toBe(true);
    expect(teams).not.toContain(otherOnly);
    expect(teams.some((t) => t.includes('::'))).toBe(false);
    expect(await page.locator('#squad-team-filter optgroup').count()).toBe(0);
  });

  test('picking a team leaves only that team\'s games', async ({ page }) => {
    await openBrowse(page);
    const { team, games } = await page.evaluate(() => {
      const r = window.__scene.rosterAll, byTeam = new Map();
      r.forEach((p) => window.__scene._teamsOf(p).forEach((t) => (byTeam.get(t) || byTeam.set(t, new Set()).get(t)).add(p.game)));
      const [team, gs] = [...byTeam.entries()].find(([, gs]) => gs.size >= 2);
      return { team, games: [...gs] };
    });
    await choose(page, '#squad-team-filter', team);
    const offered = await optionValues(page, 'squad-game-filter');
    expect(offered.sort()).toEqual(games.sort());
  });

  test('an era pick narrows the games to that era; picking it keeps the team as a plain option', async ({ page }) => {
    await openBrowse(page);
    const s = await page.evaluate(() => {
      const r = window.__scene.rosterAll, byTeam = new Map();
      r.forEach((p) => window.__scene._teamsOf(p).forEach((t) => (byTeam.get(t) || byTeam.set(t, new Set()).get(t)).add(p.game)));
      const [team, gs] = [...byTeam.entries()].find(([, gs]) => gs.size >= 2);
      return { team, g1: [...gs][0] };
    });
    await choose(page, '#squad-team-filter', `${s.team}::${s.g1}`);
    expect(await optionValues(page, 'squad-game-filter')).toEqual([s.g1]);
    await choose(page, '#squad-game-filter', s.g1);
    expect(await page.inputValue('#squad-team-filter')).toBe(s.team);
    expect(await page.locator('#pick-count').textContent()).not.toBe('0 players');
  });

  test('if the filters ever disagree, they settle on a combination that still has players', async ({ page }) => {
    await openBrowse(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, roster = s.rosterAll, byTeam = new Map();
      roster.forEach((p) => window.__scene._teamsOf(p).forEach((t) => (byTeam.get(t) || byTeam.set(t, new Set()).get(t)).add(p.game)));
      const games = [...new Set(roster.map((p) => p.game))];
      const [team, gs] = [...byTeam.entries()].find(([, gs]) => games.some((g) => !gs.has(g)));
      const absent = games.find((g) => !gs.has(g));
      const ts = document.getElementById('squad-team-filter'), gsel = document.getElementById('squad-game-filter');
      ts.value = team;
      // Not reachable through the UI (the game list follows the team), but
      // the filters must still recover if the values ever disagree.
      const o = document.createElement('option'); o.value = absent; gsel.appendChild(o); gsel.value = absent;
      s._refreshFilterOptions();
      s._renderPickListReset();
      return { team: ts.value, game: gsel.value, team0: team, count: document.getElementById('pick-count').textContent };
    });
    // The team is kept and the game it never played in is dropped.
    expect(r.team).toBe(r.team0);
    expect(r.game).toBe('');
    expect(r.count).not.toBe('0 players');
  });

  test('position options show counts, and ones with nobody left are disabled', async ({ page }) => {
    await openBrowse(page);
    const t = await page.evaluate(() => {
      const r = window.__scene.rosterAll, byTeam = new Map();
      r.forEach((p) => window.__scene._teamsOf(p).forEach((t) => { const m = byTeam.get(t) || byTeam.set(t, {}).get(t); m[p.position] = (m[p.position] || 0) + 1; }));
      // Prefer a small team missing at least one position.
      const pick = [...byTeam.entries()].find(([, m]) => ['GK', 'DF', 'MF', 'FW'].some((k) => !m[k])) || [...byTeam.entries()][0];
      return { team: pick[0], counts: pick[1] };
    });
    await choose(page, '#squad-team-filter', t.team);
    const opts = await page.evaluate(() => [...document.getElementById('squad-position-filter').options].filter((o) => o.value).map((o) => ({ v: o.value, text: o.textContent, disabled: o.disabled })));
    for (const o of opts) {
      const n = t.counts[o.v] || 0;
      expect(o.text).toBe(`${o.v} (${n})`);
      expect(o.disabled).toBe(n === 0);
    }
  });

  test('clearing the game brings back the full grouped team list', async ({ page }) => {
    await openBrowse(page);
    const before = await optionValues(page, 'squad-team-filter');
    const firstGame = (await optionValues(page, 'squad-game-filter'))[0];
    await choose(page, '#squad-game-filter', firstGame);
    expect((await optionValues(page, 'squad-team-filter')).length).toBeLessThan(before.length);
    await page.click('.filter-reset-btn[data-reset="squad-game-filter"]');
    expect(await optionValues(page, 'squad-team-filter')).toEqual(before);
    expect(await page.locator('#squad-team-filter optgroup').count()).toBeGreaterThan(0);
  });

  test('typing in the Team box suggests matching teams, and picking one filters the list', async ({ page }) => {
    await openBrowse(page);
    const team = await page.evaluate(() => {
      const counts = new Map();
      window.__scene.rosterAll.forEach((p) => window.__scene._teamsOf(p).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
      return [...counts.keys()].find((t) => t.length >= 5);
    });
    const typed = team.slice(0, 4).toLowerCase();
    await page.click('#squad-team-filter-input');
    await page.fill('#squad-team-filter-input', typed);
    const suggestions = await page.locator('#squad-team-filter-list li[role="option"]').allTextContents();
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((t) => t.toLowerCase().includes(typed))).toBe(true);
    // Names that start with what was typed come before mid-word matches.
    expect(suggestions[0].toLowerCase().startsWith(typed)).toBe(true);

    // The team's own suggestion ("Team (n)" or, for a multi-era team, its "All eras" row).
    const idx = suggestions.findIndex((t) => t.startsWith(`${team} (`) || t.startsWith(`${team} · All eras`));
    await page.locator('#squad-team-filter-list li[role="option"]').nth(idx).click();
    expect(await page.inputValue('#squad-team-filter')).toBe(team);
    await expect(page.locator('#squad-team-filter-list')).toBeHidden();
    const allMatch = await page.evaluate((team) => {
      const want = window.__scene.rosterAll.filter((p) => window.__scene._playsFor(p, team)).length;
      return document.getElementById('pick-count').textContent === `${want} players`;
    }, team);
    expect(allMatch).toBe(true);
  });

  test('typing an era finds every team\'s version of it', async ({ page }) => {
    await openBrowse(page);
    const era = await page.evaluate(() => {
      const byTeam = new Map();
      window.__scene.rosterAll.forEach((p) => window.__scene._teamsOf(p).forEach((t) => (byTeam.get(t) || byTeam.set(t, new Set()).get(t)).add(p.game)));
      return [...[...byTeam.values()].find((g) => g.size >= 2)][1];
    });
    await page.click('#squad-team-filter-input');
    await page.fill('#squad-team-filter-input', era.toLowerCase());
    const suggestions = await page.locator('#squad-team-filter-list li[role="option"]').allTextContents();
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((t) => t.includes(` · ${era} (`))).toBe(true);
  });

  test('reopening a filled Team box browses every team, centred on the current pick', async ({ page }) => {
    await openBrowse(page);
    const team = await page.evaluate(() => {
      const counts = new Map();
      window.__scene.rosterAll.forEach((p) => window.__scene._teamsOf(p).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
      const names = [...counts.keys()];
      return names[Math.floor(names.length * 0.7)];
    });
    await choose(page, '#squad-team-filter', team);
    const total = (await optionValues(page, 'squad-team-filter')).length;
    await page.click('#squad-team-filter-input');
    // Focus selects the text but doesn't turn it into a search: nothing is filtered out.
    expect(await page.locator('#squad-team-filter-list li[role="option"]').count()).toBeGreaterThan(total);
    const active = page.locator('#squad-team-filter-list li.active');
    await expect(active).toHaveCount(1);
    expect(await active.textContent()).toContain(team);
    await expect(active).toBeInViewport();
    // Typing still searches.
    await page.fill('#squad-team-filter-input', 'zzz');
    await expect(page.locator('#squad-team-filter-list .combo-empty')).toHaveText('No matches');
  });

  test('the suggestion list is long enough to scroll, and a mouse drag across rows never picks one', async ({ page }) => {
    await openBrowse(page);
    await page.click('#squad-team-filter-input');
    const list = page.locator('#squad-team-filter-list');
    const sizes = await list.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(sizes.scroll).toBeGreaterThan(sizes.client);
    await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await list.evaluate((el) => { el.scrollTop = 0; });

    // Pressing on one row and releasing on another is a drag, not a click.
    const rows = page.locator('#squad-team-filter-list li[role="option"]');
    const [a, b] = [await rows.nth(3).boundingBox(), await rows.nth(5).boundingBox()];
    await page.mouse.move(a.x + 10, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 10, b.y + b.height / 2, { steps: 4 });
    await page.mouse.up();
    expect(await page.inputValue('#squad-team-filter')).toBe('');
    await expect(list).toBeVisible();
  });

  test('keyboard: arrow down + Enter picks the first match, Escape puts back what was there', async ({ page }) => {
    await openBrowse(page);
    const game = (await optionValues(page, 'squad-game-filter'))[0];
    await page.click('#squad-game-filter-input');
    await page.fill('#squad-game-filter-input', game.toLowerCase());
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await page.inputValue('#squad-game-filter')).toBe(game);
    const label = await page.inputValue('#squad-game-filter-input');
    expect(label).toContain(game);

    await page.click('#squad-game-filter-input');
    await page.fill('#squad-game-filter-input', 'zzz');
    await expect(page.locator('#squad-game-filter-list .combo-empty')).toHaveText('No matches');
    await page.keyboard.press('Escape');
    expect(await page.inputValue('#squad-game-filter-input')).toBe(label);
    expect(await page.inputValue('#squad-game-filter')).toBe(game);
  });

  test('the Game box only suggests the chosen team\'s games, and ✕ clears the box', async ({ page }) => {
    await openBrowse(page);
    const { team, games } = await page.evaluate(() => {
      const byTeam = new Map();
      window.__scene.rosterAll.forEach((p) => window.__scene._teamsOf(p).forEach((t) => (byTeam.get(t) || byTeam.set(t, new Set()).get(t)).add(p.game)));
      const [team, g] = [...byTeam.entries()].find(([, g]) => g.size >= 2);
      return { team, games: [...g] };
    });
    await choose(page, '#squad-team-filter', team);
    expect(await page.inputValue('#squad-team-filter-input')).toContain(team);
    await page.click('#squad-game-filter-input');
    const suggested = (await page.locator('#squad-game-filter-list li[role="option"]').allTextContents()).filter((t) => t !== 'All games');
    expect(suggested.map((t) => t.split(' (')[0]).sort()).toEqual(games.sort());
    await page.keyboard.press('Escape');

    await page.click('.filter-reset-btn[data-reset="squad-team-filter"]');
    expect(await page.inputValue('#squad-team-filter-input')).toBe('');
    expect(await page.inputValue('#squad-team-filter')).toBe('');
  });

  test('emptying the box and leaving it goes back to "All"', async ({ page }) => {
    await openBrowse(page);
    const game = (await optionValues(page, 'squad-game-filter'))[0];
    await choose(page, '#squad-game-filter', game);
    await page.click('#squad-game-filter-input');
    await page.fill('#squad-game-filter-input', '');
    await page.locator('#squad-search').click();
    expect(await page.inputValue('#squad-game-filter')).toBe('');
    expect(await page.inputValue('#squad-game-filter-input')).toBe('');
  });
});

// A phone swipe on the suggestion list must scroll it, not choose the row the
// finger landed on (rows used to pick on pointerdown).
test.describe('touch scrolling of the suggestion list', () => {
  test.use({ hasTouch: true });
  test('swiping scrolls the Team list without picking a row or closing it', async ({ page }) => {
    await openBrowse(page);
    await page.locator('#squad-team-filter-input').tap();
    const list = page.locator('#squad-team-filter-list');
    await expect(list).toBeVisible();
    // Raw touch events (synthesizeScrollGesture isn't delivered in headless
    // Chromium): start on a row near the bottom and drag upwards.
    const box = await list.boundingBox();
    const x = box.x + box.width / 2;
    let y = box.y + box.height - 30;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((yy) => ({ x, y: yy })) });
    await touch('touchStart', [y]);
    for (let i = 0; i < 12; i++) { y -= 8; await touch('touchMove', [y]); await page.waitForTimeout(16); }
    await touch('touchEnd', []);
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.inputValue('#squad-team-filter')).toBe('');
    await expect(list).toBeVisible();
  });
});
