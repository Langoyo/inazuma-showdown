import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { waitForRosterLoaded } from './helpers.js';

// Guards the roster built by scripts/import-characters.mjs from the full
// character database: current ids kept, techniques on the game's scale,
// coaches and managers in, official art only where there's no pixel
// portrait, and old team names still reachable from saved state.
const roster = JSON.parse(fs.readFileSync(new URL('../public/roster.json', import.meta.url), 'utf8'));
const renames = JSON.parse(fs.readFileSync(new URL('../src/data/team-renames.json', import.meta.url), 'utf8'));
const byId = (id) => roster.find((p) => p.id === id || p.aliases?.includes(id));
const techNames = (p) => [...Object.values(p.techniques).filter(Boolean), ...p.techniquesExtra].map((t) => t.name);

test.describe('imported roster', () => {
  test('a known player keeps its id, portrait and stats, with the new technique list on the game scale', () => {
    const axel = byId('vr-2');
    expect(axel).toMatchObject({ name: 'Axel Blaze', game: 'IE1', team: 'Raimon', element: 'Fire', image: '/player_images/2_axel_blaze_pixel.png' });
    expect(axel.stats.kick).toBe(121);
    expect(techNames(axel)).toEqual(expect.arrayContaining(['Fire Tornado', 'Inazuma-1 Drop', 'The Ikaros']));
    const fireTornado = axel.techniquesExtra.find((t) => t.name === 'Fire Tornado');
    expect(fireTornado).toMatchObject({ category: 'shot', power: 82, cost: 21 });
    // The strongest of each category is the main one.
    expect(axel.techniques.shot).toMatchObject({ name: 'Inazuma-1 Drop', power: 99, cost: 30 });
  });

  // 61–110 from the database; cards kept from the previous roster go down to 55.
  test('every technique sits on the game scale, in one of the four categories', () => {
    const bad = [];
    for (const p of roster) {
      for (const [cat, t] of Object.entries(p.techniques)) if (t && !(t.power >= 55 && t.power <= 110 && t.cost >= 10 && t.cost <= 35)) bad.push(`${p.id} ${cat} ${t.name}`);
      for (const t of p.techniquesExtra) if (!['shot', 'dribble', 'defense', 'keeper'].includes(t.category) || !(t.power >= 55 && t.power <= 110)) bad.push(`${p.id} ${t.name}`);
    }
    expect(bad).toEqual([]);
  });

  test('coaches and managers are in, tagged with their role', () => {
    expect(roster.filter((p) => p.role === 'coach').length).toBeGreaterThan(90);
    expect(roster.filter((p) => p.role === 'manager').length).toBeGreaterThan(40);
    expect(roster.find((p) => p.name === 'Ray Dark' && p.game === 'IE1')).toMatchObject({ role: 'coach', team: 'Royal Academy' });
  });

  test('characters new to the roster use the official art; nobody is left without a picture', () => {
    const silvia = roster.find((p) => p.name === 'Silvia Woods' && p.game === 'IE1');
    expect(silvia.image).toMatch(/^https:\/\//);
    expect(roster.filter((p) => !p.image)).toEqual([]);
  });

  test('ids are unique, and names come through unescaped', () => {
    expect(new Set(roster.map((p) => p.id)).size).toBe(roster.length);
    expect(JSON.stringify(roster)).not.toContain('&amp;');
  });

  test('a squad saved before the import still loads, and an old team name finds its new one', async ({ page }) => {
    expect(renames.Royal).toBe('Royal Academy');
    await waitForRosterLoaded(page);
    const r = await page.evaluate(() => {
      const s = window.__scene;
      const { filled } = s._applySavedSquad({ name: 'Before', formation: '4-4-2', slots: ['vr-1', 'vr-2', 'vr-3888'], bench: [] });
      return { filled, slots: s.squadSlots.slice(0, 3), royal: s._entrantPool('Royal::IE1').length, label: s._entrantLabel('Royal::IE1') };
    });
    expect(r.filled).toBe(3);
    expect(r.slots).toEqual(['vr-1', 'vr-2', 'vr-3479']);
    expect(r.royal).toBeGreaterThanOrEqual(11);
    expect(r.label).toBe('Royal Academy (IE1)');
  });

  test('the previous roster fills the gaps: kept cards and clubs the database leaves blank', () => {
    // A card the database doesn't have is kept as it was.
    expect(byId('vr-5332')).toMatchObject({ name: 'Eldon Compayne', game: 'VR', team: 'Rugby Club' });
    expect(byId('vr-5332').image).toMatch(/^\/player_images\//);
    // A player the database calls Unaffiliated keeps the old club.
    expect(roster.filter((p) => p.team === 'Inazuma Town' && p.game === 'IE1').length).toBeGreaterThan(30);
    // An old club that was renamed comes back under its new name.
    expect(roster.some((p) => p.team === 'Royal')).toBe(false);
  });

  test('players count for every team the database lists them under', async ({ page }) => {
    expect(byId('vr-2').otherTeams).toEqual(['Inazuma National']);
    await waitForRosterLoaded(page);
    const pools = await page.evaluate(() => {
      const s = window.__scene;
      return ['Chaos::IE2', 'Chrono Storm::GO2', 'Protocol Omega 2.0::GO2', 'Protocol Omega 3.0::GO2'].map((e) => s._entrantPool(e).length);
    });
    for (const n of pools) expect(n).toBeGreaterThanOrEqual(10);
    // The Team filter offers Chaos for IE2, and picking it lists those players.
    await page.click('button[data-view="players"]');
    await page.evaluate(() => { const g = document.getElementById('squad-game-filter'); g.value = 'IE2'; g.dispatchEvent(new Event('change')); });
    const values = await page.evaluate(() => [...document.getElementById('squad-team-filter').options].map((o) => o.value));
    expect(values).toContain('Chaos');
    await page.evaluate(() => { const t = document.getElementById('squad-team-filter'); t.value = 'Chaos'; t.dispatchEvent(new Event('change')); });
    await expect(page.locator('#pick-count')).toHaveText('11 players');
  });

  test('a coach card shows its role tag', async ({ page }) => {
    await waitForRosterLoaded(page);
    await page.click('button[data-view="players"]');
    await page.fill('#squad-search', 'Ray Dark');
    await page.dispatchEvent('#squad-search', 'input');
    await expect(page.locator('#squad-pick-list .pick-card .role-tag').first()).toHaveText('Coach');
    // Ray Dark is new to the roster: official art, over an initials layer
    // that shows if that server can't be reached.
    const bg = await page.locator('#squad-pick-list .pick-card .av').first().evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain('url("https://');
    expect(bg).toContain('data:image/svg+xml');
  });
});
