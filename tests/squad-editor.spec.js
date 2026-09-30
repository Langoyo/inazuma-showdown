import { test, expect } from '@playwright/test';
import { waitForRosterLoaded } from './helpers.js';

test.describe('random squad builder', () => {
  // Rebuilds, in-page, the same per-position top-N pools _randomize() draws
  // its stars from (a pure function of the roster) as sets of player ids.
  test('the dice fills 11 starters + a bench, with 1 top-10, 3 top-30, and 5 top-40 starters', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');

    const result = await page.evaluate(() => {
      const s = window.__scene;
      const ids = (n) => new Set(Object.values(s._topNByPosition(s.rosterAll, n)).flat().map((p) => p.id));
      const top10 = ids(10), top30 = ids(30), top40 = ids(40);
      const starterIds = s.squadSlots.filter(Boolean);
      const benchIds = [...s.benchIds];
      return {
        starterCount: starterIds.length,
        benchCount: benchIds.length,
        top10Count: starterIds.filter((id) => top10.has(id)).length,
        top30Count: starterIds.filter((id) => top30.has(id)).length,
        top40Count: starterIds.filter((id) => top40.has(id)).length,
        uniqueCount: new Set([...starterIds, ...benchIds]).size,
      };
    });

    expect(result.starterCount).toBe(11);
    expect(result.benchCount).toBeGreaterThan(0);
    // "At least": an ordinary random pick can coincidentally land in a top
    // pool too, so these check the guaranteed floor, not an exact count.
    expect(result.top10Count).toBeGreaterThanOrEqual(1);
    expect(result.top30Count).toBeGreaterThanOrEqual(3);
    expect(result.top40Count).toBeGreaterThanOrEqual(5);
    // Nobody is placed twice (starters and bench are disjoint).
    expect(result.uniqueCount).toBe(result.starterCount + result.benchCount);
  });

  test('the star guarantee holds on every roll, not just a lucky one', async ({ page }) => {
    await waitForRosterLoaded(page);
    const failures = await page.evaluate(() => {
      const s = window.__scene;
      const ids = (n) => new Set(Object.values(s._topNByPosition(s.rosterAll, n)).flat().map((p) => p.id));
      const top10 = ids(10), top30 = ids(30), top40 = ids(40);
      const bad = [];
      for (let i = 0; i < 20; i++) {
        s._randomize();
        const starterIds = s.squadSlots.filter(Boolean);
        const t10 = starterIds.filter((id) => top10.has(id)).length;
        const t30 = starterIds.filter((id) => top30.has(id)).length;
        const t40 = starterIds.filter((id) => top40.has(id)).length;
        if (starterIds.length !== 11 || t10 < 1 || t30 < 3 || t40 < 5) bad.push({ roll: i, starters: starterIds.length, t10, t30, t40 });
      }
      return bad;
    });
    expect(failures).toEqual([]);
  });

  test('not every starter is a top-40 pick — it stays a mixed, surprising squad', async ({ page }) => {
    await waitForRosterLoaded(page);
    // A single roll could in principle land all-star by chance, so roll
    // several times and check at least one comes back mixed — confirming
    // the dice isn't secretly "all top players" every time.
    const anyMixed = await page.evaluate(() => {
      const s = window.__scene;
      const top40 = new Set(Object.values(s._topNByPosition(s.rosterAll, 40)).flat().map((p) => p.id));
      for (let i = 0; i < 15; i++) {
        s._randomize();
        if (s.squadSlots.filter(Boolean).some((id) => !top40.has(id))) return true;
      }
      return false;
    });
    expect(anyMixed).toBe(true);
  });
});

test.describe('team color selector', () => {
  test('picking a color overrides the auto-derived kit color on the pitch', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');
    await page.fill('#my-team-color', '#00ff00');
    await page.dispatchEvent('#my-team-color', 'input');
    await page.click('#confirm-squad-btn');
    await page.waitForFunction(() => window.__scene?.matchStarted === true, { timeout: 10000 });

    const info = await page.evaluate(() => {
      const s = window.__scene;
      return { role: s.role, teamColor: s._css3(s.role === 'A' ? s.teamColorA : s.teamColorB) };
    });
    expect(info.teamColor).toBe('#00ff00');
  });

  test('starts on Automatic, previewing the color that pick actually gives', async ({ page }) => {
    // A native color input can't be blank, so the swatch has to show
    // something — it shows what Automatic works out to for the current XI
    // rather than a fixed value that reads as a choice nobody made.
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');

    await expect(page.locator('#my-team-color-auto')).toBeChecked();
    expect(await page.evaluate(() => window.__scene.myTeamColor)).toBeNull();
    const shown = await page.evaluate(() => ({
      swatch: document.getElementById('my-team-color').value,
      derived: window.__scene._css3(window.__scene._squadColor(window.__scene.squadSlots.filter(Boolean), 0x3399ff)),
    }));
    expect(shown.swatch).toBe(shown.derived);

    // And it follows the squad, since that's what the pick is derived from.
    await page.click('#pitch-randomize-btn');
    const after = await page.evaluate(() => ({
      swatch: document.getElementById('my-team-color').value,
      derived: window.__scene._css3(window.__scene._squadColor(window.__scene.squadSlots.filter(Boolean), 0x3399ff)),
    }));
    expect(after.swatch).toBe(after.derived);
  });

  test('picking a color turns Automatic off, and a squad change no longer moves it', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');
    await page.fill('#my-team-color', '#00ff00');
    await page.dispatchEvent('#my-team-color', 'input');

    await expect(page.locator('#my-team-color-auto')).not.toBeChecked();
    await page.click('#pitch-randomize-btn');
    expect(await page.evaluate(() => window.__scene.myTeamColor)).toBe('#00ff00');
    expect(await page.inputValue('#my-team-color')).toBe('#00ff00');
  });

  test('ticking Automatic again hands it back, unticking holds the color on screen', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');
    await page.fill('#my-team-color', '#00ff00');
    await page.dispatchEvent('#my-team-color', 'input');

    await page.check('#my-team-color-auto');
    const back = await page.evaluate(() => ({
      myTeamColor: window.__scene.myTeamColor,
      swatch: document.getElementById('my-team-color').value,
      derived: window.__scene._css3(window.__scene._squadColor(window.__scene.squadSlots.filter(Boolean), 0x3399ff)),
    }));
    expect(back.myTeamColor).toBeNull();
    expect(back.swatch).toBe(back.derived);

    // Taking manual control keeps what's on screen — the color shouldn't
    // jump at the moment you go to adjust it.
    await page.uncheck('#my-team-color-auto');
    expect(await page.evaluate(() => window.__scene.myTeamColor)).toBe(back.derived);
  });

  test('leaving it untouched still falls back to the auto-derived squad color', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');
    const expectedColor = await page.evaluate(() => {
      const s = window.__scene;
      return s._css3(s._squadColor(s.squadSlots.filter(Boolean), 0x3399ff));
    });
    await page.click('#confirm-squad-btn');
    await page.waitForFunction(() => window.__scene?.matchStarted === true, { timeout: 10000 });

    const info = await page.evaluate(() => {
      const s = window.__scene;
      return { role: s.role, teamColor: s._css3(s.role === 'A' ? s.teamColorA : s.teamColorB) };
    });
    expect(info.teamColor).toBe(expectedColor);
  });
});

test.describe('position-relevant stats on a search-list card', () => {
  test('each position shows its own stat pair instead of a fixed SPD/SHT', async ({ page }) => {
    // Regression coverage for the compact card: it used to always show
    // SPD/SHT regardless of position, which told a keeper or a defender
    // nothing about the stat that actually matters for their job.
    await waitForRosterLoaded(page);

    const result = await page.evaluate(() => {
      const s = window.__scene;
      const pairs = { GK: ['intelligence', 'pressure'], DF: ['pressure', 'control'], MF: ['control', 'technique'], FW: ['kick', 'control'] };
      const abbr = { kick: 'KCK', control: 'CTL', technique: 'TEC', pressure: 'PRE', physical: 'PHY', agility: 'AGI', intelligence: 'INT' };
      const out = {};
      for (const pos of Object.keys(pairs)) {
        const p = s.rosterAll.find((r) => r.position === pos);
        if (!p) continue;
        const [a, b] = pairs[pos];
        const expected = `${abbr[a]} ${s._displayStat(p.stats[a])} ${abbr[b]} ${s._displayStat(p.stats[b])}`;
        out[pos] = { actual: s._cardStatLine(p), expected };
      }
      return out;
    });

    for (const [pos, { actual, expected }] of Object.entries(result)) {
      expect(actual, `position ${pos}`).toBe(expected);
    }
    // The four positions actually differ from each other — not just from
    // matching their own formula, but from one another, confirming the
    // pair really does vary by position rather than coincidentally
    // matching a still-fixed line.
    const lines = new Set(Object.values(result).map((r) => r.actual.split(' ')[0]));
    expect(lines.size).toBeGreaterThan(1);
  });

  test('the card actually renders the position-specific line', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('button[data-view="players"]');
    const gk = await page.evaluate(() => {
      const s = window.__scene;
      const p = s.rosterAll.find((r) => r.position === 'GK');
      // Search by full name: nicknames aren't unique (several characters
      // share a first name across positions), so filtering by one can put
      // a different player's card first.
      return { name: p.name, line: s._cardStatLine(p) };
    });
    await page.fill('#squad-search', gk.name);
    await page.waitForTimeout(150);
    const shown = await page.locator('#squad-pick-list .pick-card').first().innerText();
    expect(shown).toContain(gk.line);
    expect(shown).not.toMatch(/^KCK/m);
  });
});

test.describe('player list pagination', () => {
  test('pages through results and resets to page 1 on a new search', async ({ page }) => {
    await waitForRosterLoaded(page);
    // Below 900px, Browse Players is a drawer that starts closed (see
    // squadSectionOpen) — this test's viewport is 420px (playwright.config.js).
    await page.click('button[data-view="players"]');

    const page1Info = await page.locator('#pick-page-info').textContent();
    expect(page1Info).toMatch(/^Page 1\//);
    await expect(page.locator('#pick-prev-btn')).toBeDisabled();

    const firstNameBefore = await page.locator('#squad-pick-list .pick-name').first().textContent();
    await page.click('#pick-next-btn');
    const page2Info = await page.locator('#pick-page-info').textContent();
    expect(page2Info).toMatch(/^Page 2\//);
    const firstNameAfter = await page.locator('#squad-pick-list .pick-name').first().textContent();
    expect(firstNameAfter).not.toBe(firstNameBefore);

    // Typing a search resets back to page 1, even mid-way through the list.
    await page.fill('#squad-search', 'a');
    await page.waitForTimeout(150);
    const afterSearchInfo = await page.locator('#pick-page-info').textContent();
    expect(afterSearchInfo).toMatch(/^Page 1\//);
  });
});

test.describe('formations', () => {
  const formations = ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '4-5-1', '5-3-2', '3-4-3', '4-1-4-1', '5-4-1', '4-3-1-2'];

  for (const formation of formations) {
    test(`${formation} places exactly 11 pins`, async ({ page }) => {
      await waitForRosterLoaded(page);
      await page.selectOption('#formation-select', formation);
      await page.waitForTimeout(100);
      const count = await page.locator('#formation-pitch .slot-pin').count();
      expect(count).toBe(11);
    });
  }

  test('the Team panel picks up all ten as preset buttons', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');
    await page.click('#confirm-squad-btn');
    await page.waitForTimeout(300);
    await page.click('#sub-button');
    await page.waitForTimeout(150);
    const count = await page.locator('#formation-preset-btns button').count();
    expect(count).toBe(formations.length);
  });
});

test.describe('bench slots', () => {
  test('empty bench spots are selectable from the start, not just after one is filled', async ({ page }) => {
    // Regression test: the bench renders all 5 spots from the start (empty
    // ones included, so there's a visible hint there's a bench to fill at
    // all), but the empty placeholders never got a click handler wired up —
    // only occupied ones did — so tapping one to place a player did nothing.
    await waitForRosterLoaded(page);
    // Below 900px, Browse Players is a drawer that starts closed (see
    // squadSectionOpen) — this test's viewport is 420px (playwright.config.js).
    await page.click('button[data-view="players"]');

    const emptyPins = page.locator('#bench-strip .bench-pin.empty');
    await expect(emptyPins).toHaveCount(5);

    await emptyPins.first().click();
    const firstCard = page.locator('#squad-pick-list .pick-card').first();
    const playerName = await firstCard.locator('.pick-name').textContent();
    await firstCard.click();

    const benchNames = await page.evaluate(() => {
      const s = window.__scene;
      return [...s.benchIds].map((id) => {
        const p = s.rosterAll.find((r) => r.id === id);
        return p?.nickname || p?.name;
      });
    });
    expect(benchNames).toContain(playerName);
    await expect(page.locator('#bench-strip .bench-pin.empty')).toHaveCount(4);
  });
});

test.describe('tap a spot to fill it', () => {
  const drawerHidden = (page) => expect(page.locator('#squad-players-view')).toHaveClass(/hidden-section/);
  const drawerShown = (page) => expect(page.locator('#squad-players-view')).not.toHaveClass(/hidden-section/);

  test('tapping an empty slot opens the list narrowed to the position it asks for', async ({ page }) => {
    await waitForRosterLoaded(page);
    await drawerHidden(page);

    // An empty pin renders the role its slot asks for as its only label.
    const role = (await page.locator('#formation-pitch .slot-pin[data-slot="0"]').textContent()).trim();
    await page.click('#formation-pitch .slot-pin[data-slot="0"]');
    await drawerShown(page);

    await expect(page.locator('#pick-scope')).toBeVisible();
    await expect(page.locator('#pick-scope-role')).toHaveText(role);
    const shown = await page.evaluate(() =>
      [...new Set([...document.querySelectorAll('#squad-pick-list .pos-badge')].map((e) => e.textContent))]);
    expect(shown).toEqual([role]);
  });

  test('picking someone from there fills the spot and closes the list again', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#formation-pitch .slot-pin[data-slot="0"]');
    await drawerShown(page);

    const card = page.locator('#squad-pick-list .pick-card').first();
    const name = await card.locator('.pick-name').textContent();
    await card.click();

    // Closing itself is the point: it puts the next empty spot straight
    // under the thumb, which is what makes filling an XI two taps a player.
    await drawerHidden(page);
    const placed = await page.evaluate(() => {
      const s = window.__scene;
      const p = s.rosterAll.find((r) => r.id === s.squadSlots[0]);
      return p && (p.nickname || p.name);
    });
    expect(placed).toBe(name);
    // And the narrowing retires with the spot that asked for it.
    expect(await page.evaluate(() => window.__scene._pickPosFilter)).toBeNull();
  });

  test('"Show all" widens the list back to the whole roster without closing it', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('#formation-pitch .slot-pin[data-slot="0"]');
    const scoped = await page.locator('#pick-count').textContent();

    await page.click('#pick-scope-clear');
    await expect(page.locator('#pick-scope')).toBeHidden();
    await drawerShown(page);
    expect(await page.locator('#pick-count').textContent()).not.toBe(scoped);
  });

  test('closing the list without picking anyone drops the spot it was armed for', async ({ page }) => {
    // Otherwise that stale selection eats the next tap: with an empty spot
    // still armed, tapping a different empty one used to resolve as a swap
    // of two nothings, so the list never reopened for it.
    await waitForRosterLoaded(page);
    await page.click('#formation-pitch .slot-pin[data-slot="0"]');
    await drawerShown(page);

    await page.click('#squad-players-drawer-close');
    await drawerHidden(page);
    expect(await page.evaluate(() => window.__scene._squadSel)).toBeNull();

    const other = page.locator('#formation-pitch .slot-pin.empty').nth(5);
    const role = (await other.textContent()).trim();
    await other.click();
    await drawerShown(page);
    await expect(page.locator('#pick-scope-role')).toHaveText(role);
  });

  test('browsing the whole roster first and placing onto the pitch after still works', async ({ page }) => {
    // The other way round from the flow above, and still supported: open the
    // list yourself, pick a player, then choose where they go. Arming them
    // deliberately leaves the list open (tapping the same card again is how
    // you read their stats) — it's the placement that closes it.
    await waitForRosterLoaded(page);
    await page.click('button[data-view="players"]');
    await expect(page.locator('#pick-scope')).toBeHidden();

    const card = page.locator('#squad-pick-list .pick-card').first();
    const name = await card.locator('.pick-name').textContent();
    await card.click();
    await drawerShown(page);
    await expect(page.locator('#squad-place-hint')).toBeVisible();

    await page.click('#formation-pitch .slot-pin[data-slot="1"]');
    await drawerHidden(page);
    const placed = await page.evaluate(() => {
      const s = window.__scene;
      const p = s.rosterAll.find((r) => r.id === s.squadSlots[1]);
      return p && (p.nickname || p.name);
    });
    expect(placed).toBe(name);
  });

  test('tapping an occupied pin still just arms it, leaving the list alone', async ({ page }) => {
    // Filling is only ever what an *empty* spot can mean — an occupied one
    // is the start of a swap with another pin, which the list opening over
    // the pitch would get in the way of.
    await waitForRosterLoaded(page);
    await page.click('#pitch-randomize-btn');
    await drawerHidden(page);

    await page.click('#formation-pitch .slot-pin[data-slot="0"]');
    await drawerHidden(page);
    expect(await page.evaluate(() => window.__scene._squadSel)).toEqual({ type: 'slot', slot: 0 });
  });
});

test.describe('collapsible Formation / Browse Players sections', () => {
  test('toggling Formation while Browse Players is closed leaves it closed', async ({ page }) => {
    await waitForRosterLoaded(page);
    // Below 900px, Browse Players is a drawer that starts closed (see
    // squadSectionOpen), covering most of the screen — including the
    // Formation toggle button itself — once open, so this direction (both
    // toggles reachable) only works while it's still closed.
    await expect(page.locator('#squad-players-view')).toHaveClass(/hidden-section/);

    await page.click('button[data-view="formation"]');
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-editor')).toHaveClass(/hidden-section/);
    await expect(page.locator('#squad-players-view')).toHaveClass(/hidden-section/);

    await page.click('button[data-view="formation"]');
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-editor')).not.toHaveClass(/hidden-section/);
  });

  test('closing the Browse Players drawer via its own close button leaves Formation untouched', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('button[data-view="players"]');
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-players-view')).not.toHaveClass(/hidden-section/);
    await expect(page.locator('#squad-editor')).not.toHaveClass(/hidden-section/);

    // The drawer covers the Formation toggle button itself while open (see
    // above), so its own "✕" is the only way to close it from here.
    await page.click('#squad-players-drawer-close');
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-players-view')).toHaveClass(/hidden-section/);
    await expect(page.locator('#squad-editor')).not.toHaveClass(/hidden-section/);
  });

  test('tapping outside the drawer closes it, but tapping the pitch/bench beside it does not', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('button[data-view="players"]');
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-players-view')).not.toHaveClass(/hidden-section/);

    // A tap inside the drawer itself is obviously not "outside" it.
    await page.click('#squad-search');
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-players-view')).not.toHaveClass(/hidden-section/);

    // Nor is a tap on the pitch/bench sliver still visible beside it —
    // that's meant to stay usable (arm a bench spot, then pick from the
    // still-open drawer), not dismiss the drawer out from under it. The
    // bench-slots test above already exercises this exact combo end to
    // end; this just checks the drawer itself doesn't close mid-way.
    await page.locator('#bench-strip .bench-pin.empty').first().click();
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-players-view')).not.toHaveClass(/hidden-section/);

    // A tap genuinely outside both (the panel's top-left corner, above and
    // left of the pitch, which the drawer doesn't reach) does close it.
    await page.mouse.click(10, 10);
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-players-view')).toHaveClass(/hidden-section/);
  });

  test('closing the player stat popup does not also close the drawer behind it', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('button[data-view="players"]');
    await page.waitForTimeout(100);
    await expect(page.locator('#squad-players-view')).not.toHaveClass(/hidden-section/);

    // The stat popup is a fixed overlay rendered outside #squad-columns, so
    // opening/closing it is a click outside the drawer's own subtree — it
    // used to fall through to the "tap outside closes the drawer" handler
    // and take the drawer down with it.
    const p = await page.evaluate(() => window.__scene.rosterAll.find(Boolean));
    await page.evaluate((pl) => window.__scene._showPlayerStats(pl), p);
    await page.waitForTimeout(100);
    await expect(page.locator('#player-stat-panel')).toBeVisible();
    await expect(page.locator('#squad-players-view')).not.toHaveClass(/hidden-section/);

    await page.locator('#player-stat-panel button', { hasText: '×' }).click();
    await page.waitForTimeout(100);
    await expect(page.locator('#player-stat-panel')).toBeHidden();
    await expect(page.locator('#squad-players-view')).not.toHaveClass(/hidden-section/);
  });
});
