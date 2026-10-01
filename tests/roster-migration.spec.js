import { test, expect } from '@playwright/test';
import { waitForRosterLoaded } from './helpers.js';

// Guards the seven-stat migration (see scripts/migrate-roster-stats.mjs).
// The roster is a generated artifact now, so these assert on the shipped
// public/roster.json as the game actually loads it — a bad regeneration
// would otherwise only show up as subtly wrong gameplay.
test.describe('roster carries the games\' own seven stats', () => {
  const NATIVE = ['kick', 'control', 'technique', 'pressure', 'physical', 'agility', 'intelligence'];
  const OLD = ['speed', 'shotPower', 'dribblePower', 'defensePower', 'keeperPower'];

  test('every player has all seven, as whole numbers in the games\' own range', async ({ page }) => {
    await waitForRosterLoaded(page);

    const result = await page.evaluate((NATIVE) => {
      const roster = window.__scene.rosterAll;
      let complete = 0, inRange = 0;
      let min = Infinity, max = -Infinity;
      for (const p of roster) {
        const vals = NATIVE.map((k) => p.stats[k]);
        if (vals.every((v) => Number.isInteger(v))) complete++;
        if (vals.every((v) => v >= 50 && v <= 200)) inRange++;
        for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
      }
      return { total: roster.length, complete, inRange, min, max };
    }, NATIVE);

    expect(result.total).toBeGreaterThan(5000);
    expect(result.complete).toBe(result.total);
    expect(result.inRange).toBe(result.total);
    // Sanity that these really are the games' numbers and not a rescale:
    // the dump spans roughly 80-121 across every stat.
    expect(result.min).toBeGreaterThan(50);
    expect(result.max).toBeLessThan(140);
  });

  test('none of the five derived stats survive anywhere', async ({ page }) => {
    await waitForRosterLoaded(page);
    const leftovers = await page.evaluate((OLD) =>
      window.__scene.rosterAll.filter((p) => OLD.some((k) => k in p.stats)).length, OLD);
    expect(leftovers).toBe(0);
  });

  test('everything the migration was not meant to touch is still there', async ({ page }) => {
    // The dump has no techniques, teams, PT or nicknames — those only exist
    // in our roster, so a migration that replaced rather than merged would
    // quietly destroy them.
    await waitForRosterLoaded(page);

    const kept = await page.evaluate(() => {
      const r = window.__scene.rosterAll;
      return {
        total: r.length,
        withTechniques: r.filter((p) => p.techniques && Object.values(p.techniques).some(Boolean)).length,
        withTeam: r.filter((p) => p.team && p.teamColor).length,
        withPT: r.filter((p) => p.maxSP > 0 && p.maxStamina > 0).length,
        withNickname: r.filter((p) => p.nickname).length,
        withPosition: r.filter((p) => ['GK', 'DF', 'MF', 'FW'].includes(p.position)).length,
        idsPrefixed: r.filter((p) => typeof p.id === 'string' && p.id.startsWith('vr-')).length,
      };
    });

    expect(kept.withTeam).toBe(kept.total);
    expect(kept.withPT).toBe(kept.total);
    expect(kept.withNickname).toBe(kept.total);
    expect(kept.withPosition).toBe(kept.total);
    // Saved squads in localStorage store roster ids and nothing else, so
    // renumbering would silently break every squad anyone had saved. The
    // full-database import kept every existing id; only characters new to
    // the roster carry the database's own ("silvia-woods-17").
    expect(kept.idsPrefixed).toBeGreaterThan(4900);
    // 96.4% carry at least one supertechnique, which is exactly the rate
    // before the migration — the rest genuinely have none in the data.
    expect(kept.withTechniques / kept.total).toBeGreaterThan(0.96);
  });

  test('the element came across for every player, not just two thirds', async ({ page }) => {
    // The dump carries an affinity for everyone; our own data only had one
    // for ~69%, so this is the migration's other win and worth pinning.
    await waitForRosterLoaded(page);
    const els = await page.evaluate(() => {
      const r = window.__scene.rosterAll;
      const valid = ['Fire', 'Wood', 'Air', 'Earth'];
      return { total: r.length, withEl: r.filter((p) => valid.includes(p.element)).length };
    });
    expect(els.withEl).toBe(els.total);
  });

  test('the position-weighted rating actually discriminates', async ({ page }) => {
    // The whole reason the rating is weighted: the source data conserves a
    // near-fixed total per character, so a plain mean of the seven reads 95
    // for 71% of the roster. If someone reverts it to a flat average this
    // collapses back to a handful of values. Also checks the centring holds
    // (see _ratingBaseline) — without it forwards all outrank all keepers,
    // so the top of a rating-sorted list would never show a keeper.
    await waitForRosterLoaded(page);
    const spread = await page.evaluate(() => {
      const s = window.__scene;
      const v = s.rosterAll.map((p) => s._playerRating(p)).sort((a, b) => a - b);
      const medianOf = (pos) => {
        const r = s.rosterAll.filter((p) => p.position === pos).map((p) => s._playerRating(p)).sort((a, b) => a - b);
        return r[Math.floor(r.length / 2)];
      };
      return {
        min: v[0], max: v[v.length - 1], distinct: new Set(v).size,
        medians: ['GK', 'DF', 'MF', 'FW'].map(medianOf),
      };
    });
    expect(spread.distinct).toBeGreaterThan(10);
    expect(spread.max - spread.min).toBeGreaterThan(20);
    // Every position centres on the same number, so the ratings mean the
    // same thing whatever the job.
    for (const m of spread.medians) expect(m).toBe(spread.medians[0]);
  });
});
