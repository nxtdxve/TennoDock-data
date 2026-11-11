// Ducat-Angebote (#202): Prime-Teile in der Item-Liste, Zahl der Angebote in den Tagen, Datei bauen, prüfen, schreiben und
// im Ablauf der Action. Kein Netz: Abrufe kommen aus test/fixtures (erfundene Daten), Dateien aus dem Speicher.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { build, run, runDucats } from '../build.mjs';
import { buildDucatOffers, checkDucatOffers, DUCATS_FORMAT, encodeDucatOffers, primeParts, readDucatOffersFile } from '../lib/ducats.mjs';
import { readDay, writeDay } from '../lib/prices.mjs';
import { compactRelicsDay, parseItems, partDucats } from '../lib/sources.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-23T05:00:00Z');
const PART = '/Lotus/Types/Recipes/Weapons/WeaponParts/ExamplePrimeBarrel';
const BLUEPRINT = '/Lotus/Types/Recipes/Weapons/ExamplePrimeBlueprint';
const MOD = '/Lotus/Upgrades/Mods/Example/ExampleDamageMod';

function memoryFiles(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    read: async (path) => files.get(path),
    write: async (path, text) => void files.set(path, text),
    list: async (dir) => [...files.keys()].filter((path) => path.startsWith(`${dir}/`)).map((path) => path.slice(dir.length + 1)),
    remove: async (path) => void files.delete(path),
  };
}

/** Kompakter Tag. @param {string} day @param {Record<string, number>} offers @param {Record<string, number>} [counts] */
const compact = (day, offers, counts, source = 'relics.run') => ({ day, source, closed: {}, offers, ...(counts ? { offerCounts: counts } : {}) });
const PARTS = new Map([[PART, 100], [BLUEPRINT, 45]]);

describe('Prime parts in the item list', () => {
  it('takes the ducat value of anything but sets', () => {
    assert.equal(partDucats({ tags: ['prime', 'component', 'primary'], ducats: 45 }), 45);
    assert.equal(partDucats({ ducats: 100 }), 100);
    assert.equal(partDucats({ tags: ['set', 'prime'], ducats: 300 }), undefined);
    assert.equal(partDucats({ tags: ['prime', 'component'] }), undefined);
    assert.equal(partDucats({ tags: ['prime', 'component'], ducats: 0 }), undefined);
    assert.equal(partDucats({ ducats: 4.5 }), undefined);
  });
  it('keeps the value in the parsed list', () => {
    const items = parseItems(fixture('items.json'));
    assert.deepEqual(primeParts(items ?? new Map()), new Map([['/Lotus/Types/Recipes/WarframeRecipes/ExamplePrimeHelmetBlueprint', 45]]));
  });
});

describe('offer counts in the days', () => {
  it('keeps the number of sell offers for Prime parts only', () => {
    const items = new Map([
      ['p1', { path: PART, slug: 'example_prime_barrel', ducats: 100 }],
      ['m1', { path: MOD, slug: 'example_damage' }],
    ]);
    const text = JSON.stringify({
      Part: [
        { datetime: '2026-10-22T00:00:00.000+00:00', volume: 140, median: 4, order_type: 'sell', item_id: 'p1' },
        { datetime: '2026-10-22T00:00:00.000+00:00', volume: 9, median: 3, order_type: 'closed', item_id: 'p1' },
      ],
      Mod: [{ datetime: '2026-10-22T00:00:00.000+00:00', volume: 60, median: 5, order_type: 'sell', mod_rank: 0, item_id: 'm1' }],
    });
    const day = compactRelicsDay(text, '2026-10-22', items)?.day;
    assert.deepEqual(day?.offers, { [`${PART}|`]: 4, [`${MOD}|r0`]: 5 });
    assert.deepEqual(day?.offerCounts, { [`${PART}|`]: 140 });
  });
  it('writes and reads them, and older days without them stay readable', () => {
    const day = compact('2026-10-22', { [`${PART}|`]: 4 }, { [`${PART}|`]: 140 });
    assert.deepEqual(readDay(writeDay(day)), day);
    const old = compact('2026-10-21', { [`${PART}|`]: 4 });
    assert.equal(writeDay(old).includes('offerCounts'), false);
    assert.deepEqual(readDay(writeDay(old)), old);
    assert.equal(readDay(JSON.stringify({ v: 1, day: '2026-10-22', source: 'relics.run', closed: {}, offers: {}, offerCounts: { a: 1.5, b: -1, c: 'x' } }))?.offerCounts, undefined);
  });
});

describe('buildDucatOffers', () => {
  it('takes the newest day with part offers and the median a week before', () => {
    const days = [
      compact('2026-10-15', { [`${PART}|`]: 5, [`${MOD}|r0`]: 2 }),
      compact('2026-10-21', { [`${PART}|`]: 9 }),
      compact('2026-10-22', { [`${PART}|`]: 4, [`${BLUEPRINT}|`]: 3, [`${MOD}|r0`]: 5, [`${PART}|r1`]: 1 }, { [`${PART}|`]: 140 }),
    ];
    const offers = buildDucatOffers(days, PARTS);
    assert.equal(offers?.asOf, '2026-10-22');
    assert.equal(offers?.weekAgo, '2026-10-15');
    assert.equal(offers?.source, 'relics.run');
    assert.deepEqual([...(offers?.offers ?? [])], [
      [PART, { ducats: 100, price: 4, offers: 140, weekAgo: 5 }],
      [BLUEPRINT, { ducats: 45, price: 3 }],
    ]);
  });
  it('skips a newer day from the fallback, which has no offers', () => {
    const days = [compact('2026-10-22', { [`${PART}|`]: 4 }), { day: '2026-10-24', source: 'ducats', closed: { [`${PART}|`]: [9, 11] }, offers: {} }];
    const offers = buildDucatOffers(days, PARTS);
    assert.equal(offers?.asOf, '2026-10-22');
    assert.equal(offers?.weekAgo, undefined);
  });
  it('gives undefined without any part offer', () => {
    assert.equal(buildDucatOffers([compact('2026-10-22', { [`${MOD}|r0`]: 5 })], PARTS), undefined);
  });
});

describe('the file', () => {
  const offers = buildDucatOffers([compact('2026-10-15', { [`${PART}|`]: 5 }), compact('2026-10-22', { [`${PART}|`]: 4.04, [`${BLUEPRINT}|`]: 3 }, { [`${PART}|`]: 140 })], PARTS);
  const file = encodeDucatOffers(/** @type {NonNullable<typeof offers>} */ (offers), { generatedAt: '2026-10-23T05:00:00Z' });
  it('groups paths like the price file, with null for a missing count', () => {
    assert.deepEqual(file, {
      format: DUCATS_FORMAT,
      v: 1,
      asOf: '2026-10-22',
      generatedAt: '2026-10-23T05:00:00Z',
      source: 'relics.run (warframe.market sell offers, PC)',
      trendDays: 7,
      weekAgo: '2026-10-15',
      items: 2,
      dirs: { 'Types/Recipes/Weapons/': { ExamplePrimeBlueprint: [45, 3, null] }, 'Types/Recipes/Weapons/WeaponParts/': { ExamplePrimeBarrel: [100, 4, 140, 5] } },
    });
    assert.deepEqual(readDucatOffersFile(JSON.stringify(file)), file);
    assert.equal(readDucatOffersFile(JSON.stringify({ ...file, format: 'tennodock-prices' })), undefined);
  });
  it('is only written when it is plausible', () => {
    assert.equal(checkDucatOffers(file, undefined, 2), undefined);
    assert.match(checkDucatOffers(file, undefined) ?? '', /only 2 parts \(at least 300\)/);
    assert.match(checkDucatOffers(file, { ...file, asOf: '2026-10-23' }, 2) ?? '', /older than the current file/);
    assert.match(checkDucatOffers(file, { ...file, items: 10 }, 2) ?? '', /only 2 parts, the current file has 10/);
  });
});

describe('runDucats', () => {
  const items = JSON.stringify({ p1: [PART, 'example_prime_barrel', 100], m1: [MOD, 'example_damage', 0] });
  const prices = () => memoryFiles({ 'items.json': items, 'days/2026-10-22.json': writeDay(compact('2026-10-22', { [`${PART}|`]: 4 }, { [`${PART}|`]: 140 })) });
  const deps = (files, out, extra = {}) => ({ files, out, now: NOW, log: () => undefined, minItems: 1, ...extra });
  it('writes the file once and leaves it alone when nothing changed', async () => {
    const out = memoryFiles();
    assert.deepEqual(await runDucats(deps(prices(), out)), { written: true, asOf: '2026-10-22', items: 1 });
    assert.deepEqual(JSON.parse(out.files.get('v1/offers.json') ?? '{}').dirs, { 'Types/Recipes/Weapons/WeaponParts/': { ExamplePrimeBarrel: [100, 4, 140] } });
    const again = await runDucats(deps(prices(), out, { now: NOW + 3600 * 1000 }));
    assert.equal(again.written, false);
  });
  it('fails without marked parts or without offers, and keeps the old file', async () => {
    const out = memoryFiles({ 'v1/offers.json': 'old' });
    await assert.rejects(runDucats(deps(memoryFiles({ 'items.json': JSON.stringify({ m1: [MOD, 'example_damage', 0] }) }), out)), /no Prime parts with ducats/);
    await assert.rejects(runDucats(deps(memoryFiles({ 'items.json': items }), out)), /no day with offers/);
    await assert.rejects(runDucats(deps(prices(), out, { minItems: 300 })), /Ducats not written: only 1 parts/);
    assert.equal(out.files.get('v1/offers.json'), 'old');
  });
});

describe('in the run of the action', () => {
  /** Abrufe aus den Beispieldateien. */
  function fixtureFetch() {
    const urls = [];
    const fetchText = async (url) => {
      urls.push(url);
      if (url === 'https://relics.run/history/item_data/items.json') return { status: 200, text: fixture('items.json') };
      const day = /price_history_(\d{4}-\d{2}-\d{2})\.json$/.exec(url)?.[1];
      if (day) {
        try {
          return { status: 200, text: fixture(`price_history_${day}.json`) };
        } catch {
          return { status: 404, text: '<html>404</html>' };
        }
      }
      return { status: 404, text: '' };
    };
    return { fetchText, urls };
  }
  const buildDeps = (files, ducats, fetchText, extra = {}) => ({ fetchText, files, now: NOW, log: () => undefined, sleep: async () => undefined, minItems: 1, ducatsFiles: ducats, minDucatItems: 1, ...extra });

  it('builds the ducat offers from the same days, without asking warframe.market', async () => {
    const files = memoryFiles();
    const ducats = memoryFiles();
    const { fetchText, urls } = fixtureFetch();
    const result = await build(buildDeps(files, ducats, fetchText));
    assert.equal(result.failed, false);
    assert.equal(result.outputs['ducats_failed'], 'false');
    assert.equal(urls.some((url) => url.includes('warframe.market')), false);
    const file = JSON.parse(ducats.files.get('v1/offers.json') ?? '{}');
    assert.equal(file.asOf, '2026-10-22');
    assert.deepEqual(file.dirs, { 'Types/Recipes/WarframeRecipes/': { ExamplePrimeHelmetBlueprint: [45, 12, 40] } });
    assert.match(files.files.get('items.json') ?? '', /ExamplePrimeHelmetBlueprint","example_prime_neuroptics_blueprint",45\]/);
    assert.match(files.files.get('items.json') ?? '', /ExampleDamageMod","example_damage",0\]/);
  });
  it('never holds back the price file when the ducat offers fail', async () => {
    const files = memoryFiles();
    const ducats = memoryFiles();
    const result = await build(buildDeps(files, ducats, fixtureFetch().fetchText, { minDucatItems: 300 }));
    assert.equal(result.failed, false);
    assert.equal(result.outputs['ducats_failed'], 'true');
    assert.equal(files.files.has('v1/prices.json'), true);
    assert.equal(ducats.files.has('v1/offers.json'), false);
  });
  it('loads an item list from before #202 once, to learn the ducat values', async () => {
    const old = JSON.stringify(Object.fromEntries(JSON.parse(fixture('items.json')).filter((item) => item.gameRef).map((item) => [item.id, [item.gameRef, item.slug]])));
    const files = memoryFiles({ 'items.json': old });
    const first = fixtureFetch();
    await run({ fetchText: first.fetchText, files, now: NOW, log: () => undefined, sleep: async () => undefined, minItems: 1 });
    assert.equal(first.urls.filter((url) => url.endsWith('items.json')).length, 1);
    const second = fixtureFetch();
    await run({ fetchText: second.fetchText, files, now: NOW, log: () => undefined, sleep: async () => undefined, minItems: 1 });
    assert.equal(second.urls.filter((url) => url.endsWith('items.json')).length, 0);
  });
});
