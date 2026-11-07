// Markt-Analyse (#47): Ausreisser, Wochen, Hauptvariante, Preisänderung, Datei und Plausibilität. Kein Netz: Tage sind
// erfunden, Dateien liegen im Speicher.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build, runAnalytics } from '../build.mjs';
import {
  baseVariant,
  buildAnalytics,
  checkAnalytics,
  cleanRows,
  encodeAnalytics,
  isOutlier,
  readAnalyticsFile,
  TREND_MIN_TRADES,
} from '../lib/analytics.mjs';
import { addDays } from '../lib/days.mjs';
import { writeDay } from '../lib/prices.mjs';

const ASOF = '2026-11-06';
const NOW = Date.parse('2026-11-07T03:00:00Z');
const MOD = '/Lotus/Upgrades/Mods/Example/ExampleMod';
const PART = '/Lotus/Types/Recipes/WarframeRecipes/ExamplePrimeHelmetBlueprint';
const KEY = '/Lotus/Types/Keys/ExampleKey';

/** 14 Tage bis `ASOF`, ältester zuerst; `fill(day, index)` liefert `closed` und `offers` eines Tages. */
function fortnight(fill, source = 'relics.run') {
  return Array.from({ length: 14 }, (_, index) => {
    const day = addDays(ASOF, index - 13);
    const { closed = {}, offers = {} } = fill(day, index);
    return { day, source, closed, offers };
  });
}

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

const dayFiles = (days) => Object.fromEntries(days.map((day) => [`days/${day.day}.json`, writeDay(day)]));

describe('isOutlier', () => {
  it('drops a sale far above the offers', () => assert.equal(isOutlier(99999, 19, undefined), true));
  it('takes the lower reference when the offers are trolled too', () => assert.equal(isOutlier(99999, 7333, 200), true));
  it('keeps a sale within five times the reference', () => assert.equal(isOutlier(140, 30, 40), false));
  it('drops a sale above five times the reference from 100 platinum', () => assert.equal(isOutlier(160, 30, undefined), true));
  it('keeps cheap items: five times 5 platinum is noise', () => assert.equal(isOutlier(60, 5, 5), false));
  it('without any reference only drops more than 5,000', () => {
    assert.equal(isOutlier(4000, undefined, undefined), false);
    assert.equal(isOutlier(6000, undefined, undefined), true);
  });
});

describe('cleanRows', () => {
  it('leaves out the 99,999 day and counts it', () => {
    const days = fortnight((day, index) => ({ closed: { [`${KEY}|`]: index === 5 ? [99999, 201] : [200, 3] }, offers: { [`${KEY}|`]: index === 5 ? 7333 : 210 } }));
    const { rows, outliers } = cleanRows(days);
    assert.equal(outliers, 1);
    assert.equal(rows.get(`${KEY}|`)?.size, 13);
    assert.equal(rows.get(`${KEY}|`)?.has(days[5]?.day ?? ''), false);
  });

  it('drops a key whose only sale is an outlier', () => {
    const days = fortnight((day, index) => (index === 13 ? { closed: { [`${MOD}|r5`]: [99999, 50] }, offers: { [`${MOD}|r5`]: 19 } } : {}));
    const { rows, outliers } = cleanRows(days);
    assert.equal(outliers, 1);
    assert.equal(rows.size, 0);
  });
});

describe('baseVariant', () => {
  it('is rank 0 for ranks and intact for relics, otherwise none', () => {
    assert.equal(baseVariant(['r0', 'r10']), 'r0');
    assert.equal(baseVariant(['r5']), 'r0');
    assert.equal(baseVariant(['intact', 'radiant']), 'intact');
    assert.equal(baseVariant(['blueprint', 'crafted']), undefined);
    assert.equal(baseVariant(['']), undefined);
    assert.equal(baseVariant([]), undefined);
  });
});

describe('buildAnalytics', () => {
  it('sums platinum and sales per week and finds the main variant', () => {
    // Rang 0: viele billige Verkäufe; Rang 10: weniger, aber mehr Platin → Hauptvariante.
    const days = fortnight((day, index) => ({ closed: { [`${MOD}|r0`]: [10, 20], [`${MOD}|r10`]: index >= 7 ? [100, 3] : [80, 3] } }));
    const { items } = buildAnalytics(days, { asOf: ASOF });
    const mod = items.get(MOD);
    assert.ok(mod);
    assert.equal(mod.variant, 'r10');
    assert.equal(mod.platinum, 7 * (10 * 20 + 100 * 3));
    assert.equal(mod.sold, 7 * 23);
    assert.equal(mod.platinumBefore, 7 * (10 * 20 + 80 * 3));
    assert.equal(mod.soldBefore, 7 * 23);
    assert.equal(mod.price, 100);
    // 21 Verkäufe der Hauptvariante pro Woche, 80 → 100 Platin.
    assert.equal(mod.change, 25);
  });

  it('adds price and change of rank 0 when the main variant is another rank, as people mostly own it unranked', () => {
    const days = fortnight((day, index) => ({ closed: { [`${MOD}|r0`]: [index >= 7 ? 12 : 10, 10], [`${MOD}|r10`]: [100, 3] } }));
    const mod = buildAnalytics(days, { asOf: ASOF }).items.get(MOD);
    assert.equal(mod?.variant, 'r10');
    assert.deepEqual(mod?.base, { price: 12, change: 20 });
    // Rang 0 ist selbst die Hauptvariante: nichts doppelt.
    const cheap = buildAnalytics(fortnight(() => ({ closed: { [`${MOD}|r0`]: [10, 50], [`${MOD}|r10`]: [100, 1] } })), { asOf: ASOF }).items.get(MOD);
    assert.equal(cheap?.variant, 'r0');
    assert.equal(cheap?.base, undefined);
    // Rang 0 nie verkauft: keine Grundvariante.
    assert.equal(buildAnalytics(fortnight(() => ({ closed: { [`${MOD}|r10`]: [100, 3] } })), { asOf: ASOF }).items.get(MOD)?.base, undefined);
  });

  it('gives no change with fewer than 10 sales of the main variant in either week', () => {
    const days = fortnight((day, index) => ({ closed: index === 13 ? { [`${PART}|`]: [30, TREND_MIN_TRADES] } : index === 0 ? { [`${PART}|`]: [20, TREND_MIN_TRADES - 1] } : {} }));
    const part = buildAnalytics(days, { asOf: ASOF }).items.get(PART);
    assert.ok(part);
    assert.equal(part.price, 30);
    assert.equal(part.change, undefined);
  });

  it('gives no change below 10 platinum in both weeks', () => {
    const days = fortnight((day, index) => ({ closed: { [`${PART}|`]: [index >= 7 ? 2 : 1, 10] } }));
    assert.equal(buildAnalytics(days, { asOf: ASOF }).items.get(PART)?.change, undefined);
  });

  it('gives a change when one week reaches 10 platinum', () => {
    const days = fortnight((day, index) => ({ closed: { [`${PART}|`]: [index >= 7 ? 6 : 12, 10] } }));
    assert.equal(buildAnalytics(days, { asOf: ASOF }).items.get(PART)?.change, -50);
  });

  it('keeps an item sold only in the week before, with that price', () => {
    const days = fortnight((day, index) => ({ closed: index < 7 ? { [`${PART}|`]: [15, 2] } : {} }));
    const part = buildAnalytics(days, { asOf: ASOF }).items.get(PART);
    assert.deepEqual(part && [part.sold, part.soldBefore, part.price], [0, 14, 15]);
  });

  it('adds up the whole market per day without outliers and marks days from a fallback', () => {
    const days = fortnight((day, index) => ({ closed: { [`${KEY}|`]: index === 5 ? [99999, 201] : [200, 3], [`${PART}|`]: [10, 4] }, offers: { [`${KEY}|`]: 210 } }));
    days[13] = { ...days[13], source: 'ducats' };
    const result = buildAnalytics(days, { asOf: ASOF });
    assert.equal(result.days.length, 14);
    assert.deepEqual(result.days[5], { day: days[5]?.day, platinum: 40, sold: 4, partial: false });
    assert.deepEqual(result.days[0], { day: days[0]?.day, platinum: 640, sold: 7, partial: false });
    assert.equal(result.days[13]?.partial, true);
    assert.equal(result.outliers, 1);
  });

  it('ignores days outside the two weeks', () => {
    const days = [...fortnight(() => ({ closed: { [`${PART}|`]: [10, 1] } })), { day: addDays(ASOF, -20), source: 'relics.run', closed: { [`${PART}|`]: [999, 100] }, offers: {} }];
    const result = buildAnalytics(days, { asOf: ASOF });
    assert.equal(result.days.length, 14);
    assert.equal(result.items.get(PART)?.soldBefore, 7);
  });
});

describe('encodeAnalytics', () => {
  it('groups paths by folder, rounds and adds the variant only when there is one', () => {
    const days = fortnight((day, index) => ({ closed: { [`${MOD}|r10`]: [index >= 7 ? 100.25 : 80, 10], [`${PART}|`]: [3.33, 1] } }));
    const file = encodeAnalytics(buildAnalytics(days, { asOf: ASOF }), { generatedAt: '2026-11-07T03:00:00Z', source: 'relics.run' });
    assert.equal(file.format, 'tennodock-market');
    assert.equal(file.items, 2);
    assert.deepEqual(file.dirs['Upgrades/Mods/Example/']?.['ExampleMod'], [7018, 70, 5600, 70, 100.3, 25, 'r10']);
    assert.deepEqual(file.dirs['Types/Recipes/WarframeRecipes/']?.['ExamplePrimeHelmetBlueprint'], [23, 7, 23, 7, 3.3, null]);
    assert.deepEqual(file.days[0], [addDays(ASOF, -13), 803, 11]);
    assert.deepEqual([file.windowDays, file.minTrades, file.minPrice, file.outlierFactor], [7, 10, 10, 5]);
  });

  it('appends price and change of the base variant, null without enough sales', () => {
    // Rang 0 mit 7 Verkäufen pro Woche: Preis ja, Änderung nein.
    const days = fortnight(() => ({ closed: { [`${MOD}|r10`]: [100, 3], [`${MOD}|r0`]: [8.25, 1] } }));
    const file = encodeAnalytics(buildAnalytics(days, { asOf: ASOF }), { generatedAt: '2026-11-07T03:00:00Z', source: 'relics.run' });
    assert.deepEqual(file.dirs['Upgrades/Mods/Example/']?.['ExampleMod'], [2158, 28, 2158, 28, 100, 0, 'r10', 8.3, null]);
  });
});

describe('checkAnalytics and readAnalyticsFile', () => {
  const file = (asOf, items) => ({ format: 'tennodock-market', v: 1, asOf, generatedAt: '', source: 'relics.run', windowDays: 7, minTrades: 10, minPrice: 10, outlierFactor: 5, items, days: [], dirs: {} });
  it('wants enough items', () => assert.match(checkAnalytics(file(ASOF, 5), undefined, 10) ?? '', /only 5 items/));
  it('never goes back in time', () => assert.match(checkAnalytics(file('2026-11-05', 20), file(ASOF, 20), 10) ?? '', /older/));
  it('refuses a file with far fewer items', () => assert.match(checkAnalytics(file(ASOF, 70), file('2026-11-05', 100), 10) ?? '', /current file has 100/));
  it('accepts a plausible file', () => assert.equal(checkAnalytics(file(ASOF, 95), file('2026-11-05', 100), 10), undefined));
  it('reads only its own format', () => {
    assert.equal(readAnalyticsFile(JSON.stringify({ ...file(ASOF, 1), format: 'tennodock-prices' })), undefined);
    assert.equal(readAnalyticsFile(JSON.stringify(file(ASOF, 1)))?.items, 1);
  });
});

describe('runAnalytics', () => {
  const days = fortnight((day, index) => ({ closed: { [`${MOD}|r10`]: [index >= 7 ? 100 : 80, 10], [`${PART}|`]: [12, 11] } }));
  const deps = (files, out, extra = {}) => ({ files, out, now: NOW, log: () => undefined, minItems: 1, ...extra });

  it('writes the file, then only again when something changed', async () => {
    const files = memoryFiles(dayFiles(days));
    const out = memoryFiles();
    assert.equal((await runAnalytics(deps(files, out))).written, true);
    const first = JSON.parse(out.files.get('v1/market.json'));
    assert.equal(first.asOf, ASOF);
    assert.equal(first.items, 2);
    const later = await runAnalytics(deps(files, out, { now: NOW + 3600000 }));
    assert.equal(later.written, false);
    assert.equal(JSON.parse(out.files.get('v1/market.json')).generatedAt, first.generatedAt);
  });

  it('keeps the old file when the new one is not plausible', async () => {
    const old = JSON.stringify({ format: 'tennodock-market', v: 1, asOf: '2026-11-05', generatedAt: '', source: 'relics.run', windowDays: 7, minTrades: 10, minPrice: 10, outlierFactor: 5, items: 50, days: [], dirs: {} });
    const out = memoryFiles({ 'v1/market.json': old });
    await assert.rejects(runAnalytics(deps(memoryFiles(dayFiles(days)), out)), /current file has 50/);
    assert.equal(out.files.get('v1/market.json'), old);
  });

  it('replaces a file it cannot read', async () => {
    const out = memoryFiles({ 'v1/market.json': '{"format":"other"}' });
    assert.equal((await runAnalytics(deps(memoryFiles(dayFiles(days)), out))).written, true);
  });

  it('fails without any day', async () => {
    await assert.rejects(runAnalytics(deps(memoryFiles(), memoryFiles())), /no day data/);
  });
});

describe('build with analytics', () => {
  it('reports a failing analytics step without failing the price file', async () => {
    // Keine Tage, keine Item-Liste im Repo, kein Netz: Die Tagesdatei scheitert, Verlauf und Analyse auch, getrennt gemeldet.
    const fetchText = async () => ({ status: 404, text: '' });
    const result = await build({ fetchText, files: memoryFiles(), now: NOW, log: () => undefined, sleep: async () => undefined, analyticsFiles: memoryFiles() });
    assert.equal(result.outputs['analytics_failed'], 'true');
    assert.equal(result.outputs['trends_failed'], 'true');
  });

  it('writes the analytics even when the price file fails', async () => {
    const analyticsFiles = memoryFiles();
    const files = memoryFiles(dayFiles(days()));
    const fetchText = async () => ({ status: 404, text: '' });
    const result = await build({ fetchText, files, now: NOW, log: () => undefined, sleep: async () => undefined, minItems: 1, minSets: 0, analyticsFiles, minAnalyticsItems: 1 });
    assert.equal(result.outputs['analytics_failed'], 'false');
    assert.ok(analyticsFiles.files.has('v1/market.json'));

    function days() {
      return fortnight(() => ({ closed: { [`${PART}|`]: [12, 11] } }));
    }
  });

  it('runs no analytics without the analytics folder', async () => {
    const fetchText = async () => ({ status: 404, text: '' });
    const result = await build({ fetchText, files: memoryFiles(), now: NOW, log: () => undefined, sleep: async () => undefined });
    assert.equal(result.outputs['analytics_failed'], undefined);
  });
});
