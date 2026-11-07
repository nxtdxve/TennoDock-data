// @ts-check
// Markt-Analyse (#47, Daves Entscheidungen vom 07.11.2026): pro Item das Platin und die Stück der letzten 7 Tage und der 7
// Tage davor, Preis und Preisänderung der Hauptvariante, dazu Platin und Stück des ganzen Markts pro Tag. Aus denselben
// kompakten Tagen wie die Preise (`prices/days/`), ohne neuen Abruf. Ausreisser (z. B. „verkauft für 99'999“) fallen vorher
// weg. Format: README „Market analytics“. Doku: docs/pakete/47-analytics.md im App-Repo.

import { addDays, isDay } from './days.mjs';
import { weightedMedian } from './prices.mjs';
import { round1 } from './sources.mjs';

export const ANALYTICS_FORMAT = 'tennodock-market';
export const ANALYTICS_VERSION = 1;
/** Eine Woche: die letzten 7 Tage bis `asOf`, verglichen mit den 7 Tagen davor. */
export const WEEK_DAYS = 7;
/** Eine Preisänderung gibt es erst ab so vielen Verkäufen der Hauptvariante in beiden Wochen. */
export const TREND_MIN_TRADES = 10;
/** … und ab diesem Preis in einer der beiden Wochen; darunter wäre 1 → 2 Platin schon +100 %. */
export const TREND_MIN_PRICE = 10;
/** Ein Tagesmedian über dem Fünffachen der Referenz ist ein Ausreisser … */
export const OUTLIER_FACTOR = 5;
/** … aber erst ab diesem Preis: Bei billigen Items ist das Fünffache normales Rauschen und kostet kaum Platin. */
export const OUTLIER_MIN_PRICE = 100;
/** Ohne Angebot und ohne andere Tage: Über diesem Preis fällt eine Zeile weg. */
export const OUTLIER_WITHOUT_REFERENCE = 5000;
/** Plausibilität: so viele Items mindestens, und nicht weniger als dieser Anteil der letzten Datei. */
export const MIN_ANALYTICS_ITEMS = 1000;
export const MIN_ANALYTICS_SHARE = 0.8;

/**
 * @typedef {import('./sources.mjs').CompactDay} CompactDay
 * @typedef {{ median: number, volume: number }} TradeRow
 * @typedef {{ platinum: number, sold: number, platinumBefore: number, soldBefore: number, price: number, change?: number, variant: string }} ItemStats
 * @typedef {{ day: string, platinum: number, sold: number, partial: boolean }} MarketDay
 * @typedef {{ asOf: string, items: Map<string, ItemStats>, days: MarketDay[], outliers: number }} Analytics
 * @typedef {[platinum: number, sold: number, platinumBefore: number, soldBefore: number, price: number, change: number | null, variant?: string]} ItemEntry
 * @typedef {[day: string, platinum: number, sold: number, partial?: 'partial']} DayEntry
 * @typedef {{ format: string, v: number, asOf: string, generatedAt: string, source: string, windowDays: number,
 *   minTrades: number, minPrice: number, outlierFactor: number, items: number, days: DayEntry[],
 *   dirs: Record<string, Record<string, ItemEntry>> }} AnalyticsFile
 */

/**
 * Ausreisser: Tagesmedian über dem Fünffachen der Referenz und mindestens 100 Platin. Referenz ist der kleinere Wert aus dem
 * Angebotsmedian desselben Tages und dem gewichteten Median der übrigen Tage; Trolle stehen auch bei den Angeboten (am
 * 01.11.2026 lag der Angebotsmedian eines Schlüssels bei 7'333, verkauft „für 99'999“). Ohne beides: über 5'000.
 * @param {number} median
 * @param {number | undefined} offer
 * @param {number | undefined} history
 */
export function isOutlier(median, offer, history) {
  /** @type {number[]} */
  const references = [];
  for (const value of [offer, history]) if (value !== undefined && value > 0) references.push(value);
  if (references.length === 0) return median > OUTLIER_WITHOUT_REFERENCE;
  return median >= OUTLIER_MIN_PRICE && median > OUTLIER_FACTOR * Math.min(...references);
}

/**
 * Die Zeilen der Tage ohne Ausreisser: Schlüssel `Pfad|Variante` → Tag → [Median, Menge].
 * @param {readonly CompactDay[]} days
 * @returns {{ rows: Map<string, Map<string, TradeRow>>, outliers: number }}
 */
export function cleanRows(days) {
  /** @type {Map<string, Map<string, TradeRow & { offer?: number }>>} */
  const all = new Map();
  for (const day of days) {
    for (const [key, [median, volume]] of Object.entries(day.closed)) {
      const byDay = all.get(key) ?? new Map();
      const offer = day.offers[key];
      byDay.set(day.day, offer !== undefined ? { median, volume, offer } : { median, volume });
      all.set(key, byDay);
    }
  }
  /** @type {Map<string, Map<string, TradeRow>>} */
  const rows = new Map();
  let outliers = 0;
  for (const [key, byDay] of all) {
    /** @type {Map<string, TradeRow>} */
    const kept = new Map();
    for (const [day, row] of byDay) {
      const others = [...byDay].filter(([other]) => other !== day).map(([, other]) => /** @type {[number, number]} */ ([other.median, other.volume]));
      if (isOutlier(row.median, row.offer, weightedMedian(others))) {
        outliers++;
        continue;
      }
      kept.set(day, { median: row.median, volume: row.volume });
    }
    if (kept.size > 0) rows.set(key, kept);
  }
  return { rows, outliers };
}

/**
 * Kennzahlen der Woche bis `asOf` und der Woche davor. Hauptvariante: die mit dem meisten Platin in der letzten Woche (dann
 * in der Woche davor, dann nach Namen). Ein Item ohne Verkauf in beiden Wochen fehlt.
 * @param {readonly CompactDay[]} days
 * @param {{ asOf: string }} options
 * @returns {Analytics}
 */
export function buildAnalytics(days, { asOf }) {
  const firstNow = addDays(asOf, -(WEEK_DAYS - 1));
  const firstBefore = addDays(asOf, -(2 * WEEK_DAYS - 1));
  const inRange = days.filter((day) => day.day >= firstBefore && day.day <= asOf);
  const { rows, outliers } = cleanRows(inRange);

  /** @type {Map<string, MarketDay>} */
  const market = new Map([...inRange].sort((a, b) => a.day.localeCompare(b.day)).map((day) => [day.day, { day: day.day, platinum: 0, sold: 0, partial: day.source !== 'relics.run' }]));
  /** @type {Map<string, { variant: string, platinum: number, sold: number, platinumBefore: number, soldBefore: number, now: [number, number][], before: [number, number][] }[]>} */
  const byPath = new Map();
  for (const [key, byDay] of rows) {
    const split = key.lastIndexOf('|');
    const stats = { variant: key.slice(split + 1), platinum: 0, sold: 0, platinumBefore: 0, soldBefore: 0, now: /** @type {[number, number][]} */ ([]), before: /** @type {[number, number][]} */ ([]) };
    for (const [day, { median, volume }] of byDay) {
      const total = market.get(day);
      if (total) {
        total.platinum += median * volume;
        total.sold += volume;
      }
      if (day >= firstNow) {
        stats.platinum += median * volume;
        stats.sold += volume;
        stats.now.push([median, volume]);
      } else {
        stats.platinumBefore += median * volume;
        stats.soldBefore += volume;
        stats.before.push([median, volume]);
      }
    }
    const path = key.slice(0, split);
    byPath.set(path, [...(byPath.get(path) ?? []), stats]);
  }

  /** @type {Map<string, ItemStats>} */
  const items = new Map();
  for (const [path, variants] of byPath) {
    const sum = (/** @type {'platinum' | 'sold' | 'platinumBefore' | 'soldBefore'} */ field) => variants.reduce((total, variant) => total + variant[field], 0);
    if (sum('sold') + sum('soldBefore') === 0) continue;
    const main = /** @type {(typeof variants)[number]} */ ([...variants].sort((a, b) => b.platinum - a.platinum || b.platinumBefore - a.platinumBefore || a.variant.localeCompare(b.variant))[0]);
    const now = weightedMedian(main.now);
    const before = weightedMedian(main.before);
    const price = now ?? before;
    if (price === undefined) continue;
    /** @type {ItemStats} */
    const stats = { platinum: sum('platinum'), sold: sum('sold'), platinumBefore: sum('platinumBefore'), soldBefore: sum('soldBefore'), price, variant: main.variant };
    if (now !== undefined && before !== undefined && main.sold >= TREND_MIN_TRADES && main.soldBefore >= TREND_MIN_TRADES && Math.max(now, before) >= TREND_MIN_PRICE) {
      stats.change = Math.round((now / before - 1) * 100);
    }
    items.set(path, stats);
  }
  return { asOf, items, days: [...market.values()], outliers };
}

const LOTUS = '/Lotus/';

/**
 * Die Datei für die App: Pfade ohne `/Lotus/`, nach Ordner gruppiert wie `prices.json`, Platin ganz, Preis auf eine Stelle.
 * Sortiert, damit gleiche Daten gleiche Bytes geben.
 * @param {Analytics} analytics
 * @param {{ generatedAt: string, source: string }} header
 * @returns {AnalyticsFile}
 */
export function encodeAnalytics(analytics, header) {
  /** @type {AnalyticsFile['dirs']} */
  const dirs = {};
  let count = 0;
  for (const path of [...analytics.items.keys()].sort()) {
    if (!path.startsWith(LOTUS)) continue;
    const item = /** @type {ItemStats} */ (analytics.items.get(path));
    const rest = path.slice(LOTUS.length);
    const split = rest.lastIndexOf('/') + 1;
    /** @type {ItemEntry} */
    const entry = [Math.round(item.platinum), item.sold, Math.round(item.platinumBefore), item.soldBefore, round1(item.price), item.change ?? null];
    if (item.variant) entry.push(item.variant);
    (dirs[rest.slice(0, split)] ??= {})[rest.slice(split)] = entry;
    count++;
  }
  return {
    format: ANALYTICS_FORMAT,
    v: ANALYTICS_VERSION,
    asOf: analytics.asOf,
    generatedAt: header.generatedAt,
    source: header.source,
    windowDays: WEEK_DAYS,
    minTrades: TREND_MIN_TRADES,
    minPrice: TREND_MIN_PRICE,
    outlierFactor: OUTLIER_FACTOR,
    items: count,
    days: analytics.days.map((day) => /** @type {DayEntry} */ (day.partial ? [day.day, Math.round(day.platinum), day.sold, 'partial'] : [day.day, Math.round(day.platinum), day.sold])),
    dirs,
  };
}

/**
 * Plausibilität vor dem Schreiben: Grund, warum die Datei nicht gilt, sonst `undefined`. Dann bleibt die alte liegen.
 * @param {AnalyticsFile} next
 * @param {AnalyticsFile | undefined} previous
 * @param {number} [minItems] nur für Tests kleiner
 */
export function checkAnalytics(next, previous, minItems = MIN_ANALYTICS_ITEMS) {
  if (!isDay(next.asOf)) return `asOf is not a day (${next.asOf})`;
  if (next.items < minItems) return `only ${next.items} items (at least ${minItems})`;
  if (previous) {
    if (next.asOf < previous.asOf) return `asOf ${next.asOf} is older than the current file (${previous.asOf})`;
    if (next.items < previous.items * MIN_ANALYTICS_SHARE) return `only ${next.items} items, the current file has ${previous.items}`;
  }
  return undefined;
}

/**
 * Datei lesen (für Plausibilität und „unverändert“). `undefined`, wenn sie ein anderes Format hat.
 * @param {string} text
 * @returns {AnalyticsFile | undefined}
 */
export function readAnalyticsFile(text) {
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || parsed.format !== ANALYTICS_FORMAT || parsed.v !== ANALYTICS_VERSION || !isDay(parsed.asOf) || typeof parsed.items !== 'number') return undefined;
  return parsed;
}
