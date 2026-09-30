import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { waitForRosterLoaded } from './helpers.js';

// Guards the clean-up done by scripts/dedupe-roster.mjs.
const roster = JSON.parse(fs.readFileSync(new URL('../public/roster.json', import.meta.url), 'utf8'));
const CATS = ['shot', 'dribble', 'defense', 'keeper'];

test.describe('roster duplicates', () => {
  test('no two cards share name, game, team and position', () => {
    const seen = new Map();
    const clashes = [];
    for (const p of roster) {
      const key = [p.name, p.game, p.team, p.position].join('|');
      if (seen.has(key)) clashes.push(`${key}: ${seen.get(key)} / ${p.id}`);
      else seen.set(key, p.id);
    }
    expect(clashes).toEqual([]);
  });

  test('no card lists the same technique twice', () => {
    const repeats = roster.filter((p) => {
      const names = [
        ...CATS.filter((c) => p.techniques?.[c]).map((c) => `${c}:${p.techniques[c].name}`),
        ...(p.techniquesExtra || []).map((t) => `${t.category}:${t.name}`),
      ];
      return new Set(names).size !== names.length;
    }).map((p) => `${p.id} ${p.name}`);
    expect(repeats).toEqual([]);
  });

  test('merged copies kept their techniques, and their old ids live on as aliases', () => {
    const fei = roster.find((p) => p.id === 'vr-3479');
    expect(fei.aliases).toEqual(expect.arrayContaining(['vr-3888', 'vr-3896']));
    const techs = [...CATS.filter((c) => fei.techniques[c]).map((c) => fei.techniques[c].name), ...fei.techniquesExtra.map((t) => t.name)];
    expect(techs).toEqual(expect.arrayContaining(['Bouncing Bunny', 'Dance on Air']));
    expect(roster.some((p) => p.id === 'vr-3888' || p.id === 'vr-3896')).toBe(false);
  });

  test('a saved squad pointing at a merged copy loads the kept player, once', async ({ page }) => {
    await waitForRosterLoaded(page);
    const slots = await page.evaluate(() => {
      const s = window.__scene;
      s._applySavedSquad({ name: 'Old', formation: '4-4-2', slots: ['vr-3888', 'vr-3479', 'vr-1'], bench: ['vr-3896'] });
      return { slots: s.squadSlots.slice(0, 3), bench: [...s.benchIds] };
    });
    expect(slots.slots).toEqual(['vr-3479', null, 'vr-1']);
    expect(slots.bench).toEqual([]);
  });
});
