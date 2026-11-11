// @ts-check
// Ducat-Angebote (#202 Ducatinator, Daves Entscheidung vom 11.11.2026): pro Prime-Teil der Median der Verkaufsangebote auf
// warframe.market am neuesten Tag, die Zahl der Angebote und der Median 7 Tage davor. Aus denselben kompakten Tagen wie die
// Preise (`prices/days/`), im selben Lauf, ohne neuen Abruf. Ducats stehen nicht in der Datei: Die App nimmt sie aus dem
// DE-Export und rechnet Ducats pro Platin selbst. Angebote statt Verkäufe, weil ein Käufer den Preis der Verkäufer zahlt
// (gemessen am 11.11.2026: Angebote im Mittel 15 % über dem Preis der abgeschlossenen Trades).
// Format: README „Ducat offers“. Doku: docs/pakete/202-ducatinator.md im App-Repo.

import { addDays, isDay } from './days.mjs';
import { round1 } from './sources.mjs';

export const DUCATS_FORMAT = 'tennodock-ducat-offers';
export const DUCATS_VERSION = 1;
/** Vergleich mit dem Angebot so viele Tage vor `asOf` (Trend „günstiger als letzte Woche“). */
export const TREND_DAYS = 7;
/** Plausibilität: so viele Teile mindestens (heute rund 594), und nicht weniger als dieser Anteil der letzten Datei. */
export const MIN_DUCAT_ITEMS = 300;
export const MIN_DUCAT_SHARE = 0.8;
const LOTUS = '/Lotus/';

/**
 * @typedef {import('./sources.mjs').CompactDay} CompactDay
 * @typedef {import('./sources.mjs').Items} Items
 * @typedef {{ price: number, offers?: number, weekAgo?: number }} DucatOffer
 * @typedef {{ asOf: string, source: string, weekAgo?: string, offers: Map<string, DucatOffer> }} DucatOffers
 * @typedef {[price: number, offers: number | null, weekAgo?: number]} DucatEntry
 *   `offers` ist `null`, wenn der Tag noch keine Zahl hat (Tage vor #202); `weekAgo` fehlt ohne Angebot vor 7 Tagen.
 * @typedef {{ format: string, v: number, asOf: string, generatedAt: string, source: string, trendDays: number,
 *   weekAgo?: string, items: number, dirs: Record<string, Record<string, DucatEntry>> }} DucatFile
 */

/** Pfade der Prime-Teile aus der Item-Liste. @param {Items} items */
export function primeParts(items) {
  return new Set([...items.values()].filter((item) => item.part).map((item) => item.path));
}

/**
 * Angebote der Prime-Teile an einem Tag: Pfad → [Median, Zahl]. Prime-Teile haben keine Variante (Schlüssel `Pfad|`).
 * @param {CompactDay} day
 * @param {ReadonlySet<string>} parts
 */
function partOffers(day, parts) {
  /** @type {Map<string, { price: number, offers?: number }>} */
  const result = new Map();
  for (const [key, price] of Object.entries(day.offers)) {
    if (!key.endsWith('|')) continue;
    const path = key.slice(0, -1);
    if (!parts.has(path)) continue;
    const offers = day.offerCounts?.[key];
    result.set(path, offers === undefined ? { price } : { price, offers });
  }
  return result;
}

/**
 * Neuester Tag mit Angeboten für Prime-Teile (Tage aus dem Rückfall haben keine) und der Tag 7 Tage davor, falls es ihn
 * gibt. `undefined` ohne Tag mit Angeboten.
 * @param {readonly CompactDay[]} days
 * @param {ReadonlySet<string>} parts
 * @returns {DucatOffers | undefined}
 */
export function buildDucatOffers(days, parts) {
  const sorted = [...days].sort((a, b) => b.day.localeCompare(a.day));
  for (const day of sorted) {
    const current = partOffers(day, parts);
    if (current.size === 0) continue;
    const weekDay = addDays(day.day, -TREND_DAYS);
    const before = sorted.find((other) => other.day === weekDay);
    const previous = before ? partOffers(before, parts) : new Map();
    /** @type {Map<string, DucatOffer>} */
    const offers = new Map();
    for (const [path, offer] of current) {
      const weekAgo = previous.get(path)?.price;
      offers.set(path, weekAgo === undefined ? offer : { ...offer, weekAgo });
    }
    /** @type {DucatOffers} */
    const result = { asOf: day.day, source: day.source === 'relics.run' ? 'relics.run' : 'warframe.market', offers };
    if (previous.size > 0) result.weekAgo = weekDay;
    return result;
  }
  return undefined;
}

/**
 * Datei im Format des README: Pfade ohne `/Lotus/`, nach Ordner gruppiert wie `prices.json`.
 * @param {DucatOffers} offers
 * @param {{ generatedAt: string }} header
 * @returns {DucatFile}
 */
export function encodeDucatOffers(offers, header) {
  /** @type {DucatFile['dirs']} */
  const dirs = {};
  let count = 0;
  for (const path of [...offers.offers.keys()].sort()) {
    if (!path.startsWith(LOTUS)) continue;
    const offer = /** @type {DucatOffer} */ (offers.offers.get(path));
    const rest = path.slice(LOTUS.length);
    const split = rest.lastIndexOf('/') + 1;
    /** @type {DucatEntry} */
    const entry = [round1(offer.price), offer.offers ?? null];
    if (offer.weekAgo !== undefined) entry.push(round1(offer.weekAgo));
    (dirs[rest.slice(0, split)] ??= {})[rest.slice(split)] = entry;
    count++;
  }
  return {
    format: DUCATS_FORMAT,
    v: DUCATS_VERSION,
    asOf: offers.asOf,
    generatedAt: header.generatedAt,
    source: `${offers.source} (warframe.market sell offers, PC)`,
    trendDays: TREND_DAYS,
    ...(offers.weekAgo ? { weekAgo: offers.weekAgo } : {}),
    items: count,
    dirs,
  };
}

/**
 * Plausibilität: `undefined`, wenn die Datei geschrieben werden darf, sonst der Grund.
 * @param {DucatFile} next
 * @param {DucatFile | undefined} previous
 */
export function checkDucatOffers(next, previous, minItems = MIN_DUCAT_ITEMS) {
  if (!isDay(next.asOf)) return `asOf is not a day (${next.asOf})`;
  if (next.items < minItems) return `only ${next.items} parts (at least ${minItems})`;
  if (previous) {
    if (next.asOf < previous.asOf) return `asOf ${next.asOf} is older than the current file (${previous.asOf})`;
    if (next.items < previous.items * MIN_DUCAT_SHARE) return `only ${next.items} parts, the current file has ${previous.items}`;
  }
  return undefined;
}

/**
 * Datei lesen (für Plausibilität und „unverändert“). `undefined`, wenn sie ein anderes Format hat.
 * @param {string} text
 * @returns {DucatFile | undefined}
 */
export function readDucatOffersFile(text) {
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || parsed.format !== DUCATS_FORMAT || parsed.v !== DUCATS_VERSION || !isDay(parsed.asOf) || typeof parsed.items !== 'number') return undefined;
  return parsed;
}
