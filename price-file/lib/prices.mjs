// @ts-check
// Typischer Preis pro Item und Variante (#99, Daves Entscheidung vom 23.10.2026): gewichteter Median der Tagesmediane der
// abgeschlossenen Trades im Fenster (14 Tage), gewichtet mit der Menge. Gegenprobe mit dem Angebot: Liegt der Median der
// Verkaufsangebote des neuesten Tages darunter, gilt er (so rechnet auch tennoscope). Bei gebündelten Angeboten (Relikte zu
// sechst) ist der Angebotsmedian der Preis des Postens und damit höher, dann bleibt der Trade-Preis.
// Format der Datei: docs/pakete/99-preise-alle.md, Abschnitt 3.

import { addDays, daysBetween, isDay } from './days.mjs';
import { round1 } from './sources.mjs';

export const FORMAT = 'tennodock-prices';
export const VERSION = 1;
export const WINDOW_DAYS = 14;
/** Unter so vielen Trades zeigt die App den Preis als unsicher. Steht in der Datei, damit die App ihn nicht festschreibt. */
export const MIN_TRADES = 3;
/** Plausibilität: so viele Items mindestens, und nicht weniger als dieser Anteil der letzten Datei. */
export const MIN_ITEMS = 1000;
export const MIN_SHARE = 0.8;

/**
 * @typedef {import('./sources.mjs').CompactDay} CompactDay
 * @typedef {[price: number, trades: number, daysSinceTrade: number]} VariantPrice
 * @typedef {Map<string, Map<string, VariantPrice>>} PriceEntries Pfad → Variante → Preis
 * @typedef {{ format: string, v: number, asOf: string, generatedAt: string, windowDays: number, minTrades: number,
 *   source: string, items: number, dirs: Record<string, Record<string, VariantPrice | Record<string, VariantPrice>>> }} PriceFile
 */

/**
 * Gewichteter Median: der kleinste Wert, bis zu dem mehr als die Hälfte des Gewichts reicht; liegt genau die Hälfte
 * darunter, die Mitte zwischen ihm und dem nächsten. `undefined` ohne Gewicht.
 * @param {readonly (readonly [number, number])[]} points [Wert, Gewicht]
 */
export function weightedMedian(points) {
  const sorted = points.filter(([, weight]) => weight > 0).sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((sum, [, weight]) => sum + weight, 0);
  let cumulative = 0;
  for (let i = 0; i < sorted.length; i++) {
    const [value, weight] = /** @type {readonly [number, number]} */ (sorted[i]);
    cumulative += weight;
    if (cumulative > total / 2) return value;
    const next = sorted[i + 1];
    if (cumulative === total / 2 && next) return (value + next[0]) / 2;
  }
  return undefined;
}

/**
 * Preise aus den kompakten Tagen im Fenster, das mit `asOf` endet. Pro Variante: Preis, Menge der Trades im Fenster und
 * Tage seit dem letzten Trade (0 = am Tag `asOf`). Varianten ohne Trade im Fenster fehlen.
 * @param {readonly CompactDay[]} days
 * @param {{ asOf: string, windowDays?: number }} options
 * @returns {PriceEntries}
 */
export function buildPrices(days, { asOf, windowDays = WINDOW_DAYS }) {
  const first = addDays(asOf, -(windowDays - 1));
  const inWindow = days.filter((day) => day.day >= first && day.day <= asOf);
  /** @type {Map<string, { points: [number, number][], trades: number, last: string }>} */
  const trades = new Map();
  for (const day of inWindow) {
    for (const [key, [median, volume]] of Object.entries(day.closed)) {
      const entry = trades.get(key) ?? { points: [], trades: 0, last: day.day };
      entry.points.push([median, volume]);
      entry.trades += volume;
      if (day.day > entry.last) entry.last = day.day;
      trades.set(key, entry);
    }
  }
  // Gegenprobe mit dem neuesten Tag, der Angebote hat (die Ducat-Liste hat keine).
  const offerDay = [...inWindow].sort((a, b) => b.day.localeCompare(a.day)).find((day) => Object.keys(day.offers).length > 0);
  /** @type {PriceEntries} */
  const entries = new Map();
  for (const [key, entry] of trades) {
    const traded = weightedMedian(entry.points);
    if (traded === undefined) continue;
    const offer = offerDay?.offers[key];
    const split = key.lastIndexOf('|');
    const path = key.slice(0, split);
    const variants = entries.get(path) ?? new Map();
    variants.set(key.slice(split + 1), [round1(offer !== undefined ? Math.min(traded, offer) : traded), entry.trades, daysBetween(entry.last, asOf)]);
    entries.set(path, variants);
  }
  return entries;
}

const LOTUS = '/Lotus/';

/**
 * Die Datei für die App: Pfade ohne `/Lotus/`, nach Ordner gruppiert (spart ein Drittel gegenüber ganzen Pfaden und ist
 * nach gzip so klein wie die Kennungen von warframe.market). Ein Item nur ohne Variante steht als Liste, sonst als Objekt
 * pro Variante. Sortiert, damit gleiche Daten gleiche Bytes geben.
 * @param {PriceEntries} entries
 * @param {{ asOf: string, generatedAt: string, source: string, windowDays?: number, minTrades?: number }} header
 * @returns {PriceFile}
 */
export function encodePrices(entries, header) {
  /** @type {PriceFile['dirs']} */
  const dirs = {};
  let items = 0;
  for (const path of [...entries.keys()].sort()) {
    const variants = /** @type {Map<string, VariantPrice>} */ (entries.get(path));
    if (!path.startsWith(LOTUS) || variants.size === 0) continue;
    const rest = path.slice(LOTUS.length);
    const split = rest.lastIndexOf('/') + 1;
    const dir = rest.slice(0, split);
    const name = rest.slice(split);
    const keys = [...variants.keys()].sort();
    const only = variants.get('');
    (dirs[dir] ??= {})[name] = keys.length === 1 && only ? only : Object.fromEntries(keys.map((key) => [key, /** @type {VariantPrice} */ (variants.get(key))]));
    items++;
  }
  return {
    format: FORMAT,
    v: VERSION,
    asOf: header.asOf,
    generatedAt: header.generatedAt,
    windowDays: header.windowDays ?? WINDOW_DAYS,
    minTrades: header.minTrades ?? MIN_TRADES,
    source: header.source,
    items,
    dirs,
  };
}

/**
 * Plausibilität vor dem Schreiben: Grund, warum die Datei nicht gilt, sonst `undefined`. Dann bleibt die alte liegen.
 * @param {PriceFile} next
 * @param {PriceFile | undefined} previous
 * @param {number} [minItems] nur für Tests kleiner
 */
export function checkPrices(next, previous, minItems = MIN_ITEMS) {
  if (!isDay(next.asOf)) return `asOf is not a day (${next.asOf})`;
  if (next.items < minItems) return `only ${next.items} items (at least ${minItems})`;
  if (previous) {
    if (next.asOf < previous.asOf) return `asOf ${next.asOf} is older than the current file (${previous.asOf})`;
    if (next.items < previous.items * MIN_SHARE) return `only ${next.items} items, the current file has ${previous.items}`;
  }
  return undefined;
}

/**
 * Datei der App lesen (für die Plausibilität). `undefined`, wenn sie fehlt oder ein anderes Format hat.
 * @param {string} text
 * @returns {PriceFile | undefined}
 */
export function readPriceFile(text) {
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || parsed.format !== FORMAT || parsed.v !== VERSION || !isDay(parsed.asOf) || typeof parsed.items !== 'number') return undefined;
  return parsed;
}

/**
 * Kompakter Tag als Datei im Daten-Repo (`prices/days/<Tag>.json`) und zurück.
 * @param {CompactDay} day
 */
export function writeDay(day) {
  const sorted = (/** @type {Record<string, unknown>} */ record) => Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
  return JSON.stringify({ v: 1, day: day.day, source: day.source, closed: sorted(day.closed), offers: sorted(day.offers) });
}

/**
 * @param {string} text
 * @returns {CompactDay | undefined}
 */
export function readDay(text) {
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || parsed.v !== 1 || !isDay(parsed.day)) return undefined;
  if (!['relics.run', 'ducats', 'statistics'].includes(parsed.source)) return undefined;
  /** @type {Record<string, [number, number]>} */
  const closed = {};
  for (const [key, value] of Object.entries(parsed.closed ?? {})) {
    if (Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)) closed[key] = [value[0], value[1]];
  }
  /** @type {Record<string, number>} */
  const offers = {};
  for (const [key, value] of Object.entries(parsed.offers ?? {})) if (typeof value === 'number' && Number.isFinite(value) && value > 0) offers[key] = value;
  return { day: parsed.day, source: parsed.source, closed, offers };
}
