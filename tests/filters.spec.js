import { test, expect } from '@playwright/test';
import { waitForRosterLoaded } from './helpers.js';

// The Browse Players filters are linked: each dropdown only offers what the
// other two leave. Games/teams are picked from the loaded roster in-page, so
// these don't depend on particular names.

async function openBrowse(page) {
  await waitForRosterLoaded(page);
  await page.click('button[data-view="players"]');
}
const optionValues = (page, id) => page.evaluate((id) => [...document.getElementById(id).options].map((o) => o.value).filter(Boolean), id);

test.describe('linked Browse Players filters', () => {
  test('picking a game leaves only that game\'s teams, as plain options', async ({ page }) => {
    await openBrowse(page);
    const { game, otherOnly } = await page.evaluate(() => {
      const r = window.__scene.rosterAll;
      const teamsIn = (g) => new Set(r.filter((p) => p.game === g && p.team).map((p) => p.team));
      const games = [...new Set(r.map((p) => p.game))];
      for (const g of games) {
        const mine = teamsIn(g);
        const other = [...new Set(r.filter((p) => p.game !== g && p.team).map((p) => p.team))].find((t) => !mine.has(t));
        if (other) return { game: g, otherOnly: other };
      }
      return {};
    });
    await page.selectOption('#squad-game-filter', game);

    const teams = await optionValues(page, 'squad-team-filter');
    const validArr = await page.evaluate((g) => [...new Set(window.__scene.rosterAll.filter((p) => p.game === g && p.team).map((p) => p.team))], game);
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
      r.forEach((p) => { if (p.team) (byTeam.get(p.team) || byTeam.set(p.team, new Set()).get(p.team)).add(p.game); });
      const [team, gs] = [...byTeam.entries()].find(([, gs]) => gs.size >= 2);
      return { team, games: [...gs] };
    });
    await page.selectOption('#squad-team-filter', team);
    const offered = await optionValues(page, 'squad-game-filter');
    expect(offered.sort()).toEqual(games.sort());
  });

  test('an era pick narrows the games to that era; picking it keeps the team as a plain option', async ({ page }) => {
    await openBrowse(page);
    const s = await page.evaluate(() => {
      const r = window.__scene.rosterAll, byTeam = new Map();
      r.forEach((p) => { if (p.team) (byTeam.get(p.team) || byTeam.set(p.team, new Set()).get(p.team)).add(p.game); });
      const [team, gs] = [...byTeam.entries()].find(([, gs]) => gs.size >= 2);
      return { team, g1: [...gs][0] };
    });
    await page.selectOption('#squad-team-filter', `${s.team}::${s.g1}`);
    expect(await optionValues(page, 'squad-game-filter')).toEqual([s.g1]);
    await page.selectOption('#squad-game-filter', s.g1);
    expect(await page.inputValue('#squad-team-filter')).toBe(s.team);
    expect(await page.locator('#pick-count').textContent()).not.toBe('0 players');
  });

  test('if the filters ever disagree, they settle on a combination that still has players', async ({ page }) => {
    await openBrowse(page);
    const r = await page.evaluate(() => {
      const s = window.__scene, roster = s.rosterAll, byTeam = new Map();
      roster.forEach((p) => { if (p.team) (byTeam.get(p.team) || byTeam.set(p.team, new Set()).get(p.team)).add(p.game); });
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
      r.forEach((p) => { if (p.team) { const m = byTeam.get(p.team) || byTeam.set(p.team, {}).get(p.team); m[p.position] = (m[p.position] || 0) + 1; } });
      // Prefer a small team missing at least one position.
      const pick = [...byTeam.entries()].find(([, m]) => ['GK', 'DF', 'MF', 'FW'].some((k) => !m[k])) || [...byTeam.entries()][0];
      return { team: pick[0], counts: pick[1] };
    });
    await page.selectOption('#squad-team-filter', t.team);
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
    await page.selectOption('#squad-game-filter', firstGame);
    expect((await optionValues(page, 'squad-team-filter')).length).toBeLessThan(before.length);
    await page.click('.filter-reset-btn[data-reset="squad-game-filter"]');
    expect(await optionValues(page, 'squad-team-filter')).toEqual(before);
    expect(await page.locator('#squad-team-filter optgroup').count()).toBeGreaterThan(0);
  });
});
