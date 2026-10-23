// Tests der reinen Funktionen (#99). Laufen ohne Abhängigkeiten: node --test "price-file/**/*.test.mjs" (im Ordner des Daten-Repos)
// Alle Daten sind erfunden.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, daysBetween, isDay, utcDay, windowDays } from '../lib/days.mjs';
import { buildPrices, checkPrices, encodePrices, readDay, readPriceFile, weightedMedian, writeDay } from '../lib/prices.mjs';
import { compactDucatsDay, compactRelicsDay, parseItems, statisticsDays, variantKey } from '../lib/sources.mjs';

const MOD = '/Lotus/Upgrades/Mods/Example/ExampleDamageMod';
const RELIC = '/Lotus/Types/Game/Projections/ExampleLithX1';
const SET = '/Lotus/Powersuits/Example/ExamplePrime';
const items = new Map([
  ['a1', { path: MOD, slug: 'example_damage' }],
  ['a2', { path: RELIC, slug: 'example_lith_x1_relic' }],
  ['a3', { path: SET, slug: 'example_prime_set' }],
]);

describe('days', () => {
  it('counts in UTC across month ends', () => {
    assert.equal(utcDay(Date.parse('2026-10-31T23:59:59Z')), '2026-10-31');
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(daysBetween('2026-10-20', '2026-10-22'), 2);
    assert.equal(daysBetween('2026-10-22', '2026-10-20'), -2);
  });
  it('rejects impossible days', () => {
    assert.equal(isDay('2026-10-22'), true);
    assert.equal(isDay('2026-02-30'), false);
    assert.equal(isDay('2026-10-22T00:00'), false);
    assert.equal(isDay(20261022), false);
  });
  it('lists the window oldest first', () => {
    assert.deepEqual(windowDays('2026-10-22', 3), ['2026-10-20', '2026-10-21', '2026-10-22']);
    assert.equal(windowDays('2026-10-22', 14)[0], '2026-10-09');
  });
});

describe('variantKey', () => {
  it('uses rank, then subtype, then stars', () => {
    assert.equal(variantKey({ mod_rank: 0 }), 'r0');
    assert.equal(variantKey({ mod_rank: 10, subtype: 'x' }), 'r10');
    assert.equal(variantKey({ subtype: 'radiant' }), 'radiant');
    assert.equal(variantKey({ amber_stars: 1 }), 'a1c0');
    assert.equal(variantKey({ amber_stars: 0, cyan_stars: 2 }), 'a0c2');
    assert.equal(variantKey({ subtype: '' }), '');
    assert.equal(variantKey({}), '');
  });
});

describe('parseItems', () => {
  it('reads the relics.run list and the v2 envelope', () => {
    const entry = { id: 'b1', slug: 'thing', gameRef: '/Lotus/Thing' };
    assert.deepEqual([...(parseItems(JSON.stringify([entry])) ?? [])], [['b1', { path: '/Lotus/Thing', slug: 'thing' }]]);
    assert.equal(parseItems(JSON.stringify({ apiVersion: '0.25.0', data: [entry] }))?.get('b1')?.slug, 'thing');
  });
  it('drops entries without game path and keeps the smaller id for a shared path', () => {
    const list = parseItems(JSON.stringify([{ id: 'c2', slug: 'second', gameRef: '/Lotus/Same' }, { id: 'c1', slug: 'first', gameRef: '/Lotus/Same' }, { id: 'c3', slug: 'bundle' }, { id: 'c4', slug: 'odd', gameRef: 'Same' }]));
    assert.deepEqual([...(list ?? [])], [['c1', { path: '/Lotus/Same', slug: 'first' }]]);
  });
  it('gives undefined for anything else', () => {
    assert.equal(parseItems('{"data": "x"}'), undefined);
    assert.equal(parseItems('[]'), undefined);
  });
});

describe('compactRelicsDay', () => {
  const day = '2026-10-22';
  const text = JSON.stringify({
    'Example Damage': [
      { datetime: `${day}T00:00:00.000+00:00`, volume: 4, median: 3.04, order_type: 'closed', mod_rank: 0, item_id: 'a1' },
      { datetime: `${day}T00:00:00.000+00:00`, volume: 9, median: 5, order_type: 'sell', mod_rank: 0, item_id: 'a1' },
      { datetime: `${day}T00:00:00.000+00:00`, volume: 9, median: 2, order_type: 'buy', mod_rank: 0, item_id: 'a1' },
      { datetime: '2026-10-21T00:00:00.000+00:00', volume: 1, median: 99, order_type: 'closed', mod_rank: 10, item_id: 'a1' },
      { datetime: `${day}T00:00:00.000+00:00`, volume: 0, median: 3, order_type: 'closed', mod_rank: 5, item_id: 'a1' },
    ],
    Relic: [{ datetime: `${day}T00:00:00.000+00:00`, volume: 2, median: 7, order_type: 'closed', subtype: 'intact', item_id: 'a2' }],
    New: [
      { datetime: `${day}T00:00:00.000+00:00`, volume: 2, median: 7, order_type: 'closed', item_id: 'zz' },
      { datetime: `${day}T00:00:00.000+00:00`, volume: 2, median: 8, order_type: 'sell', item_id: 'zz' },
    ],
    Broken: 'x',
  });
  it('keeps trades and offers per variant, no buy orders, no other days, no empty rows', () => {
    const result = compactRelicsDay(text, day, items);
    assert.deepEqual(result, {
      day: { day, source: 'relics.run', closed: { [`${MOD}|r0`]: [3, 4], [`${RELIC}|intact`]: [7, 2] }, offers: { [`${MOD}|r0`]: 5 } },
      unknownIds: 1,
    });
  });
  it('gives undefined when the file is not an object', () => {
    assert.equal(compactRelicsDay('[]', day, items), undefined);
  });
});

describe('fallback sources', () => {
  it('reads the previous day of the ducat list', () => {
    const text = JSON.stringify({ payload: { previous_day: [{ datetime: '2026-10-24T00:00:00.000+00:00', item: 'a3', median: 57, volume: 18 }, { datetime: '2026-10-24T00:00:00.000+00:00', item: 'zz', median: 1, volume: 1 }] } });
    assert.deepEqual(compactDucatsDay(text, items), { day: '2026-10-24', source: 'ducats', closed: { [`${SET}|`]: [57, 18] }, offers: {} });
    assert.equal(compactDucatsDay('{"payload": {}}', items), undefined);
  });
  it('reads the days of the item statistics', () => {
    const text = JSON.stringify({
      payload: {
        statistics_closed: {
          '90days': [
            { datetime: '2026-10-21T00:00:00.000+00:00', volume: 3, median: 40, mod_rank: 10 },
            { datetime: '2026-10-21T00:00:00.000+00:00', volume: 5, median: 3, mod_rank: 0 },
            { datetime: '2026-09-01T00:00:00.000+00:00', volume: 5, median: 3, mod_rank: 0 },
          ],
        },
      },
    });
    const days = statisticsDays(text, MOD, new Set(['2026-10-21', '2026-10-22']));
    assert.deepEqual([...(days ?? [])], [['2026-10-21', { [`${MOD}|r10`]: [40, 3], [`${MOD}|r0`]: [3, 5] }]]);
    assert.equal(statisticsDays('{}', MOD, new Set()), undefined);
  });
});

describe('weightedMedian', () => {
  it('weights by volume', () => {
    assert.equal(weightedMedian([[10, 1], [20, 5], [30, 1]]), 20);
    assert.equal(weightedMedian([[12, 6], [1, 2]]), 12);
    assert.equal(weightedMedian([[5, 3]]), 5);
  });
  it('takes the middle when exactly half lies below', () => {
    assert.equal(weightedMedian([[10, 2], [20, 2]]), 15);
  });
  it('ignores empty weights', () => {
    assert.equal(weightedMedian([[10, 0]]), undefined);
    assert.equal(weightedMedian([]), undefined);
  });
});

describe('buildPrices', () => {
  /** @param {string} day @param {Record<string, [number, number]>} closed @param {Record<string, number>} [offers] */
  const day = (day, closed, offers = {}) => ({ day, source: /** @type {const} */ ('relics.run'), closed, offers });
  it('takes the weighted median over the window, with trades and days since the last trade', () => {
    const entries = buildPrices(
      [
        day('2026-10-08', { [`${SET}|`]: [500, 50] }),
        day('2026-10-20', { [`${SET}|`]: [60, 20], [`${MOD}|r10`]: [40, 2] }),
        day('2026-10-21', { [`${SET}|`]: [58, 30] }),
        day('2026-10-22', { [`${SET}|`]: [59, 25] }),
      ],
      { asOf: '2026-10-22' },
    );
    assert.deepEqual(entries.get(SET), new Map([['', [59, 75, 0]]]));
    assert.deepEqual(entries.get(MOD), new Map([['r10', [40, 2, 2]]]));
  });
  it('checks against the newest offers: a lower offer wins, a bundled (higher) offer does not', () => {
    const entries = buildPrices(
      [
        day('2026-10-21', { [`${MOD}|r0`]: [12, 6], [`${RELIC}|intact`]: [7, 10] }, { [`${MOD}|r0`]: 99 }),
        day('2026-10-22', {}, { [`${MOD}|r0`]: 3, [`${RELIC}|intact`]: 13.5 }),
      ],
      { asOf: '2026-10-22' },
    );
    assert.deepEqual(entries.get(MOD), new Map([['r0', [3, 6, 1]]]));
    assert.deepEqual(entries.get(RELIC), new Map([['intact', [7, 10, 1]]]));
  });
  it('leaves out variants without trades', () => {
    assert.equal(buildPrices([day('2026-10-22', {}, { [`${MOD}|r0`]: 3 })], { asOf: '2026-10-22' }).size, 0);
  });
});

describe('encodePrices', () => {
  const entries = new Map([
    [SET, new Map([['', /** @type {[number, number, number]} */ ([59, 75, 0])]])],
    [MOD, new Map([['r10', /** @type {[number, number, number]} */ ([40, 2, 2])], ['r0', [3, 6, 1]]])],
    ['/Other/Path', new Map([['', /** @type {[number, number, number]} */ ([1, 1, 0])]])],
  ]);
  const file = encodePrices(entries, { asOf: '2026-10-22', generatedAt: '2026-10-23T04:20:00Z', source: 'relics.run' });
  it('groups paths by folder without /Lotus/, a single plain variant as a list', () => {
    assert.deepEqual(file, {
      format: 'tennodock-prices',
      v: 1,
      asOf: '2026-10-22',
      generatedAt: '2026-10-23T04:20:00Z',
      windowDays: 14,
      minTrades: 3,
      source: 'relics.run',
      items: 2,
      dirs: { 'Powersuits/Example/': { ExamplePrime: [59, 75, 0] }, 'Upgrades/Mods/Example/': { ExampleDamageMod: { r0: [3, 6, 1], r10: [40, 2, 2] } } },
    });
  });
  it('writes the same bytes for the same data', () => {
    const again = encodePrices(new Map([...entries].reverse()), { asOf: '2026-10-22', generatedAt: '2026-10-23T04:20:00Z', source: 'relics.run' });
    assert.equal(JSON.stringify(again), JSON.stringify(file));
  });
  it('reads back only its own format', () => {
    assert.equal(readPriceFile(JSON.stringify(file))?.items, 2);
    assert.equal(readPriceFile(JSON.stringify({ ...file, v: 2 })), undefined);
    assert.equal(readPriceFile('{"format": "other"}'), undefined);
  });
});

describe('checkPrices', () => {
  const file = (items, asOf = '2026-10-22') => ({ format: 'tennodock-prices', v: 1, asOf, generatedAt: '', windowDays: 14, minTrades: 3, source: '', items, dirs: {} });
  it('needs enough items and no drop below 80 %', () => {
    assert.equal(checkPrices(file(3500), undefined), undefined);
    assert.match(checkPrices(file(900), undefined) ?? '', /only 900 items/);
    assert.equal(checkPrices(file(2900), file(3500, '2026-10-21')), undefined);
    assert.match(checkPrices(file(2700), file(3500, '2026-10-21')) ?? '', /current file has 3500/);
  });
  it('never goes back in time', () => {
    assert.match(checkPrices(file(3500, '2026-10-20'), file(3500, '2026-10-21')) ?? '', /older/);
  });
});

describe('day files', () => {
  it('round-trip and reject other formats', () => {
    const day = { day: '2026-10-22', source: /** @type {const} */ ('ducats'), closed: { b: [2, 1], a: [1, 3] }, offers: {} };
    const text = writeDay(day);
    assert.equal(text, '{"v":1,"day":"2026-10-22","source":"ducats","closed":{"a":[1,3],"b":[2,1]},"offers":{}}');
    assert.deepEqual(readDay(text), { ...day, closed: { a: [1, 3], b: [2, 1] } });
    assert.equal(readDay('{"v":2,"day":"2026-10-22","source":"ducats"}'), undefined);
    assert.equal(readDay('{"v":1,"day":"2026-10-22","source":"elsewhere"}'), undefined);
    assert.deepEqual(readDay('{"v":1,"day":"2026-10-22","source":"relics.run","closed":{"a":[0,1],"b":[1,2,3],"c":[4,5]},"offers":{"a":-1,"c":6}}'), {
      day: '2026-10-22',
      source: 'relics.run',
      closed: { c: [4, 5] },
      offers: { c: 6 },
    });
  });
});
