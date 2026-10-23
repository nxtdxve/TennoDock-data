// Ablauf der Action mit der kleinen Beispieldatei (#99): erster Lauf, Folgetag, neue Items, Ausfall von relics.run,
// Rückfall und Plausibilität. Kein Netz: Abrufe kommen aus test/fixtures (erfundene Daten), Dateien aus dem Speicher.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { run } from '../build.mjs';
import { writeDay } from '../lib/prices.mjs';
import { compactRelicsDay } from '../lib/sources.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-23T05:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const NEW_ITEM = { id: '00000000000000000000a0ff', slug: 'newer_example', gameRef: '/Lotus/Types/Items/Example/NewerExample' };

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

/** Abrufe aus den Beispieldateien. `withNewItem`: Die Item-Liste kennt schon das Item, das nur am 22.10. gehandelt wurde. */
function fixtureFetch({ relicsDown = false, wfmDown = false, withNewItem = false } = {}) {
  const urls = [];
  const fetchText = async (url) => {
    urls.push(url);
    if (url === 'https://relics.run/history/item_data/items.json') {
      const list = JSON.parse(fixture('items.json'));
      return { status: 200, text: JSON.stringify(withNewItem ? [...list, NEW_ITEM] : list) };
    }
    const day = /price_history_(\d{4}-\d{2}-\d{2})\.json$/.exec(url)?.[1];
    if (day) {
      if (relicsDown) throw new Error('fetch failed');
      try {
        return { status: 200, text: fixture(`price_history_${day}.json`) };
      } catch {
        return { status: 404, text: '<html>404</html>' };
      }
    }
    if (url === 'https://api.warframe.market/v1/tools/ducats') return wfmDown ? { status: 503, text: '' } : { status: 200, text: fixture('ducats.json') };
    return { status: 404, text: '' };
  };
  return { fetchText, urls };
}

/** Item-Liste, wie sie im Daten-Repo liegt (ohne das neue Item). */
const storedItems = () => JSON.stringify(Object.fromEntries(JSON.parse(fixture('items.json')).filter((item) => item.gameRef).map((item) => [item.id, [item.gameRef, item.slug]])));
/** Ein Tag im Format von `prices/days/`, gebaut aus der Beispieldatei von relics.run. */
function relicsDayFile(source, day = source) {
  const items = new Map(JSON.parse(fixture('items.json')).filter((item) => item.gameRef).map((item) => [item.id, { path: item.gameRef, slug: item.slug }]));
  const compact = compactRelicsDay(fixture(`price_history_${source}.json`), source, items);
  return writeDay({ ...compact.day, day });
}

const deps = (files, fetchText, extra = {}) => ({ fetchText, files, now: NOW, log: () => undefined, sleep: async () => undefined, minItems: 1, ...extra });
const prices = (files) => JSON.parse(files.files.get('v1/prices.json') ?? 'null');

describe('first run', () => {
  it('fetches the item list and the whole window once and writes the file', async () => {
    const files = memoryFiles();
    const { fetchText, urls } = fixtureFetch();
    const result = await run(deps(files, fetchText));
    assert.equal(result.written, true);
    assert.equal(result.asOf, '2026-10-22');
    assert.deepEqual(result.warnings, []);
    assert.equal(urls.filter((url) => url.includes('price_history_')).length, 14);
    assert.equal(urls.filter((url) => url.endsWith('items.json')).length, 1);
    assert.equal(urls.some((url) => url.includes('warframe.market')), false);
    assert.deepEqual([...files.files.keys()].filter((path) => path.startsWith('days/')).sort(), ['days/2026-10-20.json', 'days/2026-10-21.json', 'days/2026-10-22.json']);
    const file = prices(files);
    assert.equal(file.source, 'relics.run');
    assert.equal(file.generatedAt, '2026-10-23T05:00:00Z');
    assert.equal(file.items, 5);
    assert.deepEqual(file.dirs, {
      'Powersuits/Example/': { ExamplePrime: [59, 75, 0] },
      'Types/Game/Projections/': { ExampleLithX1: { intact: [7, 16, 0], radiant: [20, 2, 0] } },
      'Types/Items/Ayatan/': { ExampleSculpture: { a0c0: [8, 3, 1] } },
      'Types/Recipes/WarframeRecipes/': { ExamplePrimeHelmetBlueprint: [10, 12, 0] },
      'Upgrades/Mods/Example/': { ExampleDamageMod: { r0: [3, 5, 1], r10: [40, 2, 2] } },
    });
  });
});

describe('later runs', () => {
  it('does nothing when the file is up to date, but rebuilds on request', async () => {
    const files = memoryFiles();
    await run(deps(files, fixtureFetch().fetchText));
    const before = files.files.get('v1/prices.json');
    const again = fixtureFetch();
    const result = await run(deps(files, again.fetchText));
    assert.equal(result.written, false);
    assert.deepEqual(again.urls, []);
    const rebuilt = await run(deps(files, fixtureFetch().fetchText, { rebuild: true, now: NOW + 60 * 1000 }));
    assert.equal(rebuilt.written, true);
    assert.notEqual(files.files.get('v1/prices.json'), before);
  });
  it('asks only for days after the newest one', async () => {
    const files = memoryFiles({ 'items.json': storedItems(), 'days/2026-10-20.json': relicsDayFile('2026-10-20') });
    const { fetchText, urls } = fixtureFetch();
    await run(deps(files, fetchText));
    assert.deepEqual(urls.filter((url) => url.includes('price_history_')), ['https://relics.run/history/price_history_2026-10-21.json', 'https://relics.run/history/price_history_2026-10-22.json']);
  });
  it('reloads the item list once when a day has unknown items', async () => {
    const files = memoryFiles({ 'items.json': storedItems(), 'days/2026-10-21.json': relicsDayFile('2026-10-21') });
    const { fetchText, urls } = fixtureFetch({ withNewItem: true });
    await run(deps(files, fetchText));
    assert.equal(urls.filter((url) => url.endsWith('items.json')).length, 1);
    assert.deepEqual(prices(files).dirs['Types/Items/Example/'], { NewerExample: [99, 1, 0] });
    assert.match(files.files.get('items.json') ?? '', /NewerExample/);
  });
  it('drops days before the window', async () => {
    const files = memoryFiles({ 'items.json': storedItems(), 'days/2026-10-01.json': relicsDayFile('2026-10-20', '2026-10-01'), 'days/2026-10-22.json': relicsDayFile('2026-10-22') });
    await run(deps(files, fixtureFetch().fetchText));
    assert.equal(files.files.has('days/2026-10-01.json'), false);
    assert.equal(files.files.has('days/2026-10-22.json'), true);
  });
});

describe('relics.run fails', () => {
  it('uses the ducat list for prime items after two days and warns', async () => {
    const files = memoryFiles();
    await run(deps(files, fixtureFetch().fetchText));
    const down = fixtureFetch({ relicsDown: true });
    const result = await run(deps(files, down.fetchText, { now: NOW + 2 * DAY_MS }));
    assert.equal(result.relicsBehind, 2);
    assert.match(result.warnings[0] ?? '', /relics\.run has no new file for 2 days/);
    assert.equal(down.urls.filter((url) => url.endsWith('/v1/tools/ducats')).length, 1);
    assert.equal(result.asOf, '2026-10-24');
    const file = prices(files);
    assert.equal(file.source, 'relics.run + warframe.market');
    assert.deepEqual(file.dirs['Powersuits/Example/'], { ExamplePrime: [58, 93, 0] });
    assert.deepEqual(file.dirs['Upgrades/Mods/Example/'].ExampleDamageMod.r0, [3, 5, 3]);
  });
  it('waits one day before the fallback and never asks warframe.market when it is off', async () => {
    const files = memoryFiles();
    await run(deps(files, fixtureFetch().fetchText));
    const oneDay = fixtureFetch({ relicsDown: true });
    const first = await run(deps(files, oneDay.fetchText, { now: NOW + DAY_MS }));
    assert.deepEqual(first.warnings, []);
    assert.equal(oneDay.urls.some((url) => url.includes('warframe.market')), false);
    const off = fixtureFetch({ relicsDown: true });
    const second = await run(deps(files, off.fetchText, { now: NOW + 3 * DAY_MS, fallback: 'off' }));
    assert.equal(off.urls.some((url) => url.includes('warframe.market')), false);
    assert.equal(second.written, false);
    assert.equal(second.warnings.length, 1);
  });
  it('keeps the old file when the new one is not plausible', async () => {
    const files = memoryFiles();
    await run(deps(files, fixtureFetch().fetchText));
    const before = files.files.get('v1/prices.json');
    await assert.rejects(run(deps(files, fixtureFetch().fetchText, { rebuild: true, minItems: 100 })), /Prices not written: only 5 items/);
    assert.equal(files.files.get('v1/prices.json'), before);
  });
});

describe('full fallback', () => {
  it('collects the window from the item statistics, one item after the other', async () => {
    const files = memoryFiles();
    const statistics = JSON.stringify({ payload: { statistics_closed: { '90days': [{ datetime: '2026-10-23T00:00:00.000+00:00', volume: 4, median: 50 }] } } });
    const urls = [];
    const fetchText = async (url) => {
      urls.push(url);
      if (url.endsWith('items.json')) return { status: 200, text: fixture('items.json') };
      if (url.includes('/statistics')) return { status: 200, text: statistics };
      throw new Error('fetch failed');
    };
    const result = await run(deps(files, fetchText, { fallback: 'full', now: NOW + DAY_MS }));
    assert.equal(urls.filter((url) => url.includes('/statistics')).length, 5);
    assert.equal(result.asOf, '2026-10-23');
    assert.equal(prices(files).source, 'warframe.market');
    assert.deepEqual(prices(files).dirs['Powersuits/Example/'], { ExamplePrime: [50, 4, 0] });
  });
});
