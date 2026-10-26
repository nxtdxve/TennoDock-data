// Verlaufsdatei der Prime-Sets (#54): Wochen und Tage, Nachholen bei relics.run, Plausibilität. Kein Netz: Abrufe und
// Tage sind erfunden, Dateien liegen im Speicher.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { build, runTrends } from '../build.mjs';
import { addDays } from '../lib/days.mjs';
import { writeDay } from '../lib/prices.mjs';
import {
  addTrendDays,
  checkTrends,
  dayPrices,
  decodeTrends,
  encodeTrends,
  missingWeeks,
  primeSets,
  readTrendFile,
  settle,
  TREND_DAYS,
  TREND_WEEKS,
  trendRange,
  weekOf,
} from '../lib/trends.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const SET = '/Lotus/Powersuits/Example/ExamplePrime';
const SET_ID = '00000000000000000000a003';
const NOW = Date.parse('2026-10-23T05:00:00Z');
const HEADER = { asOf: '2026-10-22', generatedAt: '2026-10-23T05:00:00Z', source: 'relics.run' };

/** Ein kompakter Tag mit dem Set (und einer Blaupause, die nicht in den Verlauf gehört). */
const compactDay = (day, price, source = 'relics.run') => ({ day, source, closed: { [`${SET}|`]: [price, 10], '/Lotus/Types/Recipes/WarframeRecipes/ExamplePrimeHelmetBlueprint|': [9, 3] }, offers: {} });
/** Ein Tag von relics.run, wie er geladen wird. */
const relicsDay = (day, price) => JSON.stringify({ 'Example Prime Set': [{ datetime: `${day}T00:00:00.000+00:00`, volume: 5, median: price, order_type: 'closed', item_id: SET_ID }] });
const storedItems = () => JSON.stringify(Object.fromEntries(JSON.parse(fixture('items.json')).filter((item) => item.gameRef).map((item) => [item.id, [item.gameRef, item.slug]])));

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

const deps = (files, fetchText, extra = {}) => ({ fetchText, files, now: NOW, log: () => undefined, sleep: async () => undefined, minSets: 1, ...extra });
const trends = (files) => JSON.parse(files.files.get('v1/trends.json') ?? 'null');

/** Item-Liste und zwei Tage in `prices/days/`, wie sie die Action vorfindet. */
const start = () =>
  memoryFiles({
    'items.json': storedItems(),
    'days/2026-10-21.json': writeDay(compactDay('2026-10-21', 58)),
    'days/2026-10-22.json': writeDay(compactDay('2026-10-22', 62)),
  });
const noFetch = async (url) => assert.fail(`unexpected fetch ${url}`);

describe('weeks and sets', () => {
  it('starts a week on Monday (UTC)', () => {
    assert.equal(weekOf('2026-10-25'), '2026-10-19');
    assert.equal(weekOf('2026-10-19'), '2026-10-19');
    assert.equal(weekOf('2026-10-22'), '2026-10-19');
  });
  it('covers two years of weeks and 90 days', () => {
    const { dayStart, weekStart } = trendRange('2026-10-22');
    assert.equal(dayStart, '2026-07-25');
    assert.equal(weekStart, addDays('2026-10-19', -7 * 104));
    assert.equal(weekOf(weekStart), weekStart);
  });
  it('keeps only prime sets and rounds their price', () => {
    const items = new Map(JSON.parse(fixture('items.json')).filter((item) => item.gameRef).map((item) => [item.id, { path: item.gameRef, slug: item.slug }]));
    const paths = primeSets(items);
    assert.deepEqual([...paths], [SET]);
    assert.deepEqual([...dayPrices(compactDay('2026-10-22', 59.6), paths)], [[SET, 60]]);
  });
});

describe('building the file', () => {
  it('writes one value per day and the median per week', () => {
    const state = decodeTrends(undefined);
    addTrendDays(state, [['2026-10-19', 50], ['2026-10-20', 60], ['2026-10-21', 70], ['2026-10-22', 80]].map(([day, price]) => ({ day, prices: new Map([[SET, price]]) })), '2026-10-22');
    settle(state, '2026-10-22');
    const file = encodeTrends(state, HEADER);
    const trend = file.dirs['Powersuits/Example/'].ExamplePrime;
    assert.equal(trend.w.length, TREND_WEEKS);
    assert.equal(trend.d.length, TREND_DAYS);
    assert.deepEqual(trend.d.slice(-4), [50, 60, 70, 80]);
    assert.equal(trend.w.at(-1), 65);
    assert.equal(trend.w.filter((value) => value !== null).length, 1);
    assert.equal(file.items, 1);
    assert.deepEqual(decodeTrends(file), state);
  });
  it('fills an empty older week from a backfilled day, but never overwrites one', () => {
    const state = decodeTrends(undefined);
    addTrendDays(state, [{ day: '2025-06-12', prices: new Map([[SET, 40]]) }], '2026-10-22');
    addTrendDays(state, [{ day: '2025-06-13', prices: new Map([[SET, 99]]) }], '2026-10-22');
    settle(state, '2026-10-22');
    assert.equal(state.get(SET)?.weeks.get('2025-06-09'), 40);
    assert.equal(state.get(SET)?.days.size, 0);
  });
  it('keeps the value of a week whose days left the 90 days, and replaces a day that came again', () => {
    const state = decodeTrends(undefined);
    addTrendDays(state, [{ day: '2026-07-27', prices: new Map([[SET, 30]]) }, { day: '2026-07-28', prices: new Map([[SET, 34]]) }], '2026-10-22');
    settle(state, '2026-10-22');
    assert.equal(state.get(SET)?.weeks.get('2026-07-27'), 32);
    // Vier Tage später liegen beide Tage vor dem Tagesteil; die Woche behält ihren Wert.
    addTrendDays(state, [{ day: '2026-10-26', prices: new Map([[SET, 50]]) }], '2026-10-26');
    settle(state, '2026-10-26');
    assert.equal(state.get(SET)?.days.has('2026-07-27'), false);
    assert.equal(state.get(SET)?.weeks.get('2026-07-27'), 32);
    // Ein Tag, der neu kommt (relics.run nach dem Rückfall), ersetzt den alten Wert.
    addTrendDays(state, [{ day: '2026-10-26', prices: new Map([[SET, 52]]) }], '2026-10-26');
    settle(state, '2026-10-26');
    assert.equal(state.get(SET)?.days.get('2026-10-26'), 52);
  });
  it('lists the Thursday of every week without any value, up to asOf', () => {
    const state = decodeTrends(undefined);
    addTrendDays(state, [{ day: '2026-10-20', prices: new Map([[SET, 60]]) }], '2026-10-22');
    settle(state, '2026-10-22');
    const missing = missingWeeks(encodeTrends(state, HEADER));
    assert.equal(missing.length, TREND_WEEKS - 1);
    assert.equal(missing[0], addDays(trendRange('2026-10-22').weekStart, 3));
    assert.equal(missing.at(-1), '2026-10-15');
    assert.ok(missing.every((day) => new Date(`${day}T00:00:00Z`).getUTCDay() === 4));
  });
  it('checks the file before writing', () => {
    const state = decodeTrends(undefined);
    addTrendDays(state, [{ day: '2026-10-22', prices: new Map([[SET, 60]]) }], '2026-10-22');
    settle(state, '2026-10-22');
    const file = encodeTrends(state, HEADER);
    assert.equal(checkTrends(file, undefined, 1), undefined);
    assert.match(checkTrends(file, undefined) ?? '', /only 1 sets/);
    assert.match(checkTrends(file, { ...file, asOf: '2026-10-23' }, 1) ?? '', /older/);
    assert.deepEqual(readTrendFile(JSON.stringify(file)), file);
    assert.equal(readTrendFile(JSON.stringify({ ...file, v: 2 })), undefined);
    assert.equal(readTrendFile(JSON.stringify({ ...file, dirs: { 'A/': { B: { w: [] } } } })), undefined);
  });
});

describe('runTrends', () => {
  it('builds the file from the stored days without any fetch, and only writes when something changed', async () => {
    const files = start();
    const result = await runTrends(deps(files, noFetch));
    assert.deepEqual(result, { written: true, asOf: '2026-10-22', sets: 1, backfilled: 0 });
    const file = trends(files);
    assert.equal(file.format, 'tennodock-trends');
    assert.equal(file.source, 'relics.run');
    assert.deepEqual(file.dirs['Powersuits/Example/'].ExamplePrime.d.slice(-2), [58, 62]);
    assert.equal(file.dirs['Powersuits/Example/'].ExamplePrime.w.at(-1), 60);
    const again = await runTrends(deps(files, noFetch, { now: NOW + 60 * 1000 }));
    assert.equal(again.written, false);
  });
  it('adds a new day on the next run and keeps the older ones from the file', async () => {
    const files = start();
    await runTrends(deps(files, noFetch));
    files.files.delete('days/2026-10-21.json');
    files.files.set('days/2026-10-23.json', writeDay(compactDay('2026-10-23', 66, 'ducats')));
    const result = await runTrends(deps(files, noFetch, { now: NOW + 24 * 60 * 60 * 1000 }));
    assert.equal(result.asOf, '2026-10-23');
    const file = trends(files);
    assert.deepEqual(file.dirs['Powersuits/Example/'].ExamplePrime.d.slice(-3), [58, 62, 66]);
    assert.equal(file.source, 'relics.run + warframe.market');
  });
  it('backfills one Thursday per empty week from relics.run, with a pause between downloads', async () => {
    const files = start();
    const urls = [];
    const pauses = [];
    const fetchText = async (url) => {
      urls.push(url);
      const day = /price_history_(\d{4}-\d{2}-\d{2})\.json$/.exec(url)?.[1];
      if (!day) return { status: 404, text: '' };
      // Eine Woche fehlt bei relics.run, eine Datei ist leer, eine kein JSON: Diese Wochen bleiben leer, der Rest kommt.
      if (day === '2026-10-15') return { status: 404, text: '<html>404</html>' };
      if (day === '2026-10-08') return { status: 200, text: '{}' };
      if (day === '2026-10-01') return { status: 200, text: '<html>maintenance</html>' };
      return { status: 200, text: relicsDay(day, 40) };
    };
    const result = await runTrends(deps(files, fetchText, { backfill: true, sleep: async (ms) => void pauses.push(ms) }));
    assert.equal(urls.length, TREND_WEEKS - 1);
    assert.ok(urls.every((url) => url.startsWith('https://relics.run/history/price_history_')));
    assert.equal(pauses.length, urls.length - 1);
    assert.ok(pauses.every((ms) => ms === 3000));
    assert.equal(result.backfilled, TREND_WEEKS - 4);
    const trend = trends(files).dirs['Powersuits/Example/'].ExamplePrime;
    assert.equal(trend.w.filter((value) => value === null).length, 3);
    assert.equal(trend.w[0], 40);
    // Nachgeholte Tage im Tagesteil zählen dort als Tag.
    assert.equal(trend.d.filter((value) => value === 40).length, 9);
    // Ein zweiter Lauf fragt nur die drei leeren Wochen nach.
    urls.length = 0;
    await runTrends(deps(files, fetchText, { backfill: true }));
    assert.deepEqual(urls.map((url) => /(\d{4}-\d{2}-\d{2})/.exec(url)?.[1]), ['2026-10-01', '2026-10-08', '2026-10-15']);
  });
  it('does not write a file with too few sets and leaves the old one', async () => {
    const files = start();
    await assert.rejects(runTrends(deps(files, noFetch, { minSets: 100 })), /Trends not written: only 1 sets/);
    assert.equal(files.files.has('v1/trends.json'), false);
  });
  it('never takes an unreadable file as empty, so two years are not replaced by 14 days', async () => {
    for (const text of ['{"format":"tennodock-trends","v":2}', '{broken']) {
      const files = start();
      files.files.set('v1/trends.json', text);
      await assert.rejects(runTrends(deps(files, noFetch)), /v1\/trends\.json is not readable/);
      assert.equal(files.files.get('v1/trends.json'), text);
    }
  });
});

describe('build', () => {
  it('writes the price file even when the trends fail, and reports the trends separately', async () => {
    const logs = [];
    const files = start();
    const result = await build(deps(files, noFetch, { minItems: 1, minSets: 100, log: (text) => void logs.push(text) }));
    assert.deepEqual(result, { failed: false, outputs: { stale: 'false', asOf: '2026-10-22', trends_failed: 'true' } });
    assert.equal(files.files.has('v1/prices.json'), true);
    assert.equal(files.files.has('v1/trends.json'), false);
    assert.ok(logs.some((line) => line.startsWith('::error::Trends not written')));
  });
  it('reports both files as fine on a normal run', async () => {
    const files = start();
    const result = await build(deps(files, noFetch, { minItems: 1 }));
    assert.deepEqual(result, { failed: false, outputs: { stale: 'false', asOf: '2026-10-22', trends_failed: 'false' } });
    assert.equal(files.files.has('v1/trends.json'), true);
  });
});
