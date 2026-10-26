// @ts-check
// Preisverlauf der Prime-Sets (#54 K1, Daves Entscheidung vom 26.10.2026): pro Set ein Wert pro Woche über 2 Jahre und
// ein Wert pro Tag über 90 Tage, für die Seite Vault-Tracker der App. Gebaut aus denselben kompakten Tagen wie die
// Tagesdatei (#99). Die Datei ist zugleich ihr eigener Speicher: Jeder Lauf liest sie, trägt die Tage aus `prices/days/`
// ein und schneidet alte Werte ab. Für die Vergangenheit holt der Lauf einmal pro Woche einen Tag von relics.run nach.
// Format: README.md, Abschnitt „Price trends“; Doku: docs/pakete/54-vault-tracker.md im App-Repo.

import { addDays, daysBetween, isDay } from './days.mjs';

export const TRENDS_FORMAT = 'tennodock-trends';
export const TRENDS_VERSION = 1;
/** 2 Jahre und die laufende Woche. */
export const TREND_WEEKS = 105;
export const TREND_DAYS = 90;
/** Plausibilität: so viele Sets mindestens (heute rund 170 bei warframe.market). */
export const MIN_SETS = 100;
/** Erste Tagesdatei von relics.run; früher gibt es nichts nachzuholen. */
export const RELICS_FIRST_DAY = '2021-09-12';
const SET_SLUG = /_prime_set$/;
const LOTUS = '/Lotus/';

/**
 * @typedef {import('./sources.mjs').CompactDay} CompactDay
 * @typedef {import('./sources.mjs').Items} Items
 * @typedef {{ w: (number | null)[], d: (number | null)[] }} SetTrend Wochen ab `weekStart`, Tage ab `dayStart`; `null` = kein Trade
 * @typedef {{ format: string, v: number, asOf: string, generatedAt: string, source: string, weekStart: string, dayStart: string,
 *   items: number, dirs: Record<string, Record<string, SetTrend>> }} TrendFile
 * @typedef {Map<string, { weeks: Map<string, number>, days: Map<string, number> }>} TrendState Pfad → Woche (Montag) bzw. Tag → Platin
 */

/** Montag der Woche (UTC) eines Tages. @param {string} day */
export function weekOf(day) {
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

/** Erster Tag des Tagesteils und erste Woche des Wochenteils für `asOf`. @param {string} asOf */
export function trendRange(asOf) {
  return { dayStart: addDays(asOf, -(TREND_DAYS - 1)), weekStart: addDays(weekOf(asOf), -7 * (TREND_WEEKS - 1)) };
}

/** Pfade der Prime-Sets in der Item-Liste (Slug `…_prime_set`; der Pfad ist der des Primes). @param {Items} items */
export function primeSets(items) {
  return new Set([...items.values()].filter((item) => SET_SLUG.test(item.slug)).map((item) => item.path));
}

/**
 * Preis jedes Sets an einem Tag: Median der abgeschlossenen Trades, auf ganze Platin gerundet. Sets ohne Trade fehlen.
 * @param {CompactDay} day
 * @param {ReadonlySet<string>} paths
 */
export function dayPrices(day, paths) {
  /** @type {Map<string, number>} */
  const prices = new Map();
  for (const path of paths) {
    const value = day.closed[`${path}|`];
    if (value) prices.set(path, Math.max(1, Math.round(value[0])));
  }
  return prices;
}

/** Median, bei gerader Anzahl die Mitte, gerundet. @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 === 1 ? /** @type {number} */ (sorted[mid]) : (/** @type {number} */ (sorted[mid - 1]) + /** @type {number} */ (sorted[mid])) / 2);
}

/** Datei → Zustand. Eine Datei in anderem Format gilt als leer. @param {TrendFile | undefined} file @returns {TrendState} */
export function decodeTrends(file) {
  /** @type {TrendState} */
  const state = new Map();
  if (!file) return state;
  for (const [dir, names] of Object.entries(file.dirs)) {
    for (const [name, trend] of Object.entries(names)) {
      const entry = { weeks: new Map(), days: new Map() };
      trend.w.forEach((value, i) => typeof value === 'number' && entry.weeks.set(addDays(file.weekStart, 7 * i), value));
      trend.d.forEach((value, i) => typeof value === 'number' && entry.days.set(addDays(file.dayStart, i), value));
      state.set(`${LOTUS}${dir}${name}`, entry);
    }
  }
  return state;
}

/** @param {TrendState} state @param {string} path */
const entryOf = (state, path) => {
  let entry = state.get(path);
  if (!entry) state.set(path, (entry = { weeks: new Map(), days: new Map() }));
  return entry;
};

/**
 * Tage eintragen: Ein Tag im Tagesteil ersetzt, was für ihn stand (z. B. ein Tag aus dem Rückfall, den relics.run jetzt
 * hat). Ein älterer Tag (nachgeholt) füllt nur eine leere Woche.
 * @param {TrendState} state
 * @param {readonly { day: string, prices: ReadonlyMap<string, number> }[]} days
 * @param {string} asOf
 */
export function addTrendDays(state, days, asOf) {
  const { dayStart, weekStart } = trendRange(asOf);
  for (const { day, prices } of days) {
    if (day > asOf) continue;
    if (day >= dayStart) {
      for (const entry of state.values()) entry.days.delete(day);
      for (const [path, price] of prices) entryOf(state, path).days.set(day, price);
      continue;
    }
    const week = weekOf(day);
    if (week < weekStart) continue;
    for (const [path, price] of prices) {
      const entry = entryOf(state, path);
      if (!entry.weeks.has(week)) entry.weeks.set(week, price);
    }
  }
}

/**
 * Alte Werte abschneiden und die Wochen aus den Tagen rechnen: Median der Tage einer Woche, für Wochen, die ganz im
 * Tagesteil liegen oder noch keinen Wert haben. Ältere Wochen behalten ihren Wert, auch wenn ihre Tage herausfallen.
 * @param {TrendState} state
 * @param {string} asOf
 */
export function settle(state, asOf) {
  const { dayStart, weekStart } = trendRange(asOf);
  for (const [path, entry] of state) {
    for (const day of [...entry.days.keys()]) if (day < dayStart || day > asOf) entry.days.delete(day);
    for (const week of [...entry.weeks.keys()]) if (week < weekStart || week > asOf) entry.weeks.delete(week);
    /** @type {Map<string, number[]>} */
    const byWeek = new Map();
    for (const [day, price] of entry.days) byWeek.set(weekOf(day), [...(byWeek.get(weekOf(day)) ?? []), price]);
    for (const [week, prices] of byWeek) if (week >= dayStart || !entry.weeks.has(week)) entry.weeks.set(week, median(prices));
    if (entry.weeks.size === 0 && entry.days.size === 0) state.delete(path);
  }
}

/**
 * Zustand → Datei, nach Ordner gruppiert wie die Tagesdatei, sortiert, damit gleiche Daten gleiche Bytes geben.
 * @param {TrendState} state
 * @param {{ asOf: string, generatedAt: string, source: string }} header
 * @returns {TrendFile}
 */
export function encodeTrends(state, header) {
  const { dayStart, weekStart } = trendRange(header.asOf);
  /** @type {TrendFile['dirs']} */
  const dirs = {};
  let items = 0;
  for (const path of [...state.keys()].sort()) {
    const entry = /** @type {TrendState extends Map<string, infer E> ? E : never} */ (state.get(path));
    if (!path.startsWith(LOTUS)) continue;
    const rest = path.slice(LOTUS.length);
    const split = rest.lastIndexOf('/') + 1;
    const w = Array.from({ length: TREND_WEEKS }, (_, i) => entry.weeks.get(addDays(weekStart, 7 * i)) ?? null);
    const d = Array.from({ length: TREND_DAYS }, (_, i) => entry.days.get(addDays(dayStart, i)) ?? null);
    if (w.every((value) => value === null) && d.every((value) => value === null)) continue;
    (dirs[rest.slice(0, split)] ??= {})[rest.slice(split)] = { w, d };
    items++;
  }
  return { format: TRENDS_FORMAT, v: TRENDS_VERSION, asOf: header.asOf, generatedAt: header.generatedAt, source: header.source, weekStart, dayStart, items, dirs };
}

/**
 * Wochen ohne einen einzigen Wert, als Donnerstag der Woche (der Tag, der nachgeholt wird), ältester zuerst. Nur Tage bis
 * `asOf` und ab der ersten Datei von relics.run.
 * @param {TrendFile} file
 */
export function missingWeeks(file) {
  /** @type {string[]} */
  const days = [];
  for (let i = 0; i < TREND_WEEKS; i++) {
    const thursday = addDays(file.weekStart, 7 * i + 3);
    if (thursday > file.asOf || thursday < RELICS_FIRST_DAY) continue;
    const known = Object.values(file.dirs).some((names) => Object.values(names).some((trend) => trend.w[i] !== null && trend.w[i] !== undefined));
    if (!known) days.push(thursday);
  }
  return days;
}

/**
 * Plausibilität vor dem Schreiben: Grund, warum die Datei nicht gilt, sonst `undefined`.
 * @param {TrendFile} next
 * @param {TrendFile | undefined} previous
 * @param {number} [minSets] nur für Tests kleiner
 */
export function checkTrends(next, previous, minSets = MIN_SETS) {
  if (!isDay(next.asOf)) return `asOf is not a day (${next.asOf})`;
  if (next.items < minSets) return `only ${next.items} sets (at least ${minSets})`;
  if (previous && next.asOf < previous.asOf) return `asOf ${next.asOf} is older than the current file (${previous.asOf})`;
  return undefined;
}

/**
 * Datei lesen. `undefined`, wenn sie fehlt oder ein anderes Format hat.
 * @param {string} text
 * @returns {TrendFile | undefined}
 */
export function readTrendFile(text) {
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || parsed.format !== TRENDS_FORMAT || parsed.v !== TRENDS_VERSION) return undefined;
  if (!isDay(parsed.asOf) || !isDay(parsed.weekStart) || !isDay(parsed.dayStart) || typeof parsed.dirs !== 'object' || parsed.dirs === null) return undefined;
  // Fremde Längen (z. B. nach einer Änderung von TREND_DAYS) liest decodeTrends über die Daten, nicht über die Länge.
  if (daysBetween(parsed.weekStart, parsed.asOf) < 0) return undefined;
  for (const names of Object.values(parsed.dirs)) {
    for (const trend of Object.values(/** @type {Record<string, unknown>} */ (names))) {
      const value = /** @type {Record<string, unknown>} */ (trend);
      if (!Array.isArray(value?.['w']) || !Array.isArray(value?.['d'])) return undefined;
    }
  }
  return parsed;
}
