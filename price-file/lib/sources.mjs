// @ts-check
// Eingaben der Tagesdatei (#99): die Tagesdateien von relics.run (alle Items, Format von `statistics_closed` und
// `statistics_live` bei warframe.market), dazu als Rückfall die Ducat-Liste und die Statistik pro Item von
// warframe.market. Alles wird zu einem „kompakten Tag“: pro Pfad und Variante Median und Menge der abgeschlossenen Trades,
// dazu der Median der Verkaufsangebote. Kaufgebote und Hoch/Tief-Werte fallen weg.
// Recherche: docs/research/2026-10-23-marktpreise-alle-items.md, Abschnitt 3; docs/pakete/99-preise-alle.md

import { isDay } from './days.mjs';

export const RELICS_RUN = 'https://relics.run';
export const WFM = 'https://api.warframe.market';
/** Item-Liste von warframe.market (`/v2/items`) als Kopie bei relics.run, täglich um rund 03:36 UTC neu. */
export const RELICS_ITEMS_URL = `${RELICS_RUN}/history/item_data/items.json`;
export const WFM_ITEMS_URL = `${WFM}/v2/items`;
export const DUCATS_URL = `${WFM}/v1/tools/ducats`;

/** Tagesdatei von relics.run für den Tag `day` (erscheint am Folgetag um rund 02:21 UTC). @param {string} day */
export const relicsDayUrl = (day) => `${RELICS_RUN}/history/price_history_${day}.json`;
/** Statistik eines Items (v1), für den Vollabruf. @param {string} slug */
export const statisticsUrl = (slug) => `${WFM}/v1/items/${encodeURIComponent(slug)}/statistics`;

/**
 * @typedef {{ path: string, slug: string }} ItemRef
 * @typedef {Map<string, ItemRef>} Items Kennung (`id` in `/v2/items`) → Lotus-Pfad (`gameRef`) und Slug.
 * @typedef {'relics.run' | 'ducats' | 'statistics'} DaySource
 * @typedef {{ day: string, source: DaySource, closed: Record<string, [number, number]>, offers: Record<string, number> }} CompactDay
 *   Schlüssel `Pfad|Variante`; `closed`: [Median, Menge] der abgeschlossenen Trades; `offers`: Median der Verkaufsangebote.
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** @param {unknown} value */
const positive = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined);
/** Eine Nachkommastelle reicht für Platin. @param {number} value */
export const round1 = (value) => Math.round(value * 10) / 10;

/**
 * Variante einer Zeile: `r<Rang>` (Mods, Arcanes), sonst `subtype` (Relikte `intact` … `radiant`, Fische, Blaupause oder
 * gebaut), sonst `a<Bernstein>c<Cyan>` (Ayatan-Skulpturen), sonst leer. Gleiche Schlüssel liest die App.
 * @param {Record<string, unknown>} row
 */
export function variantKey(row) {
  if (Number.isInteger(row['mod_rank'])) return `r${row['mod_rank']}`;
  const subtype = row['subtype'];
  if (typeof subtype === 'string' && subtype !== '') return subtype;
  const amber = row['amber_stars'];
  const cyan = row['cyan_stars'];
  if (Number.isInteger(amber) || Number.isInteger(cyan)) return `a${Number.isInteger(amber) ? amber : 0}c${Number.isInteger(cyan) ? cyan : 0}`;
  return '';
}

/**
 * Item-Liste lesen: relics.run (`items.json`, eine Liste) oder warframe.market (`/v2/items`, Hülle mit `data`).
 * Einträge ohne `gameRef` fallen weg. Zwei Kennungen mit demselben Pfad (heute Prisma Shade): die kleinere Kennung gilt,
 * wie in der App der erste Eintrag.
 * @param {string} text
 * @returns {Items | undefined}
 */
export function parseItems(text) {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed['data']) ? parsed['data'] : undefined;
  if (!list) return undefined;
  /** @type {Items} */
  const items = new Map();
  const paths = new Set();
  const entries = list.filter(isRecord).sort((a, b) => String(a['id']).localeCompare(String(b['id'])));
  for (const entry of entries) {
    const { id, slug, gameRef } = entry;
    if (typeof id !== 'string' || typeof slug !== 'string' || typeof gameRef !== 'string' || !gameRef.startsWith('/Lotus/') || paths.has(gameRef)) continue;
    paths.add(gameRef);
    items.set(id, { path: gameRef, slug });
  }
  return items.size > 0 ? items : undefined;
}

/**
 * Tagesdatei von relics.run → kompakter Tag. Zeilen eines anderen Tages fallen weg. `unknownIds`: Kennungen, die die
 * Item-Liste nicht kennt (dann ist sie veraltet). `undefined`, wenn die Datei kein Objekt ist.
 * @param {string} text
 * @param {string} day
 * @param {Items} items
 * @returns {{ day: CompactDay, unknownIds: number } | undefined}
 */
export function compactRelicsDay(text, day, items) {
  const parsed = JSON.parse(text);
  if (!isRecord(parsed)) return undefined;
  /** @type {CompactDay} */
  const compact = { day, source: 'relics.run', closed: {}, offers: {} };
  const unknown = new Set();
  for (const rows of Object.values(parsed)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const id = row['item_id'];
      const item = typeof id === 'string' ? items.get(id) : undefined;
      if (!item) {
        if (typeof id === 'string') unknown.add(id);
        continue;
      }
      const datetime = row['datetime'];
      if (typeof datetime === 'string' && !datetime.startsWith(day)) continue;
      const median = positive(row['median']);
      if (median === undefined) continue;
      const key = `${item.path}|${variantKey(row)}`;
      if (row['order_type'] === 'closed') {
        const volume = positive(row['volume']);
        if (volume !== undefined) compact.closed[key] = [round1(median), volume];
      } else if (row['order_type'] === 'sell') compact.offers[key] = round1(median);
    }
  }
  return { day: compact, unknownIds: unknown.size };
}

/**
 * Rückfall für Prime-Items: Teil `previous_day` der Ducat-Liste von warframe.market (1 Abruf, rund 750 Items, ohne
 * Varianten). Nur abgeschlossene Trades. `undefined` ohne lesbaren Tag.
 * @param {string} text
 * @param {Items} items
 * @returns {CompactDay | undefined}
 */
export function compactDucatsDay(text, items) {
  const parsed = JSON.parse(text);
  const payload = isRecord(parsed) ? parsed['payload'] : undefined;
  const rows = isRecord(payload) && Array.isArray(payload['previous_day']) ? payload['previous_day'] : undefined;
  if (!rows) return undefined;
  /** @type {CompactDay | undefined} */
  let compact;
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = row['item'];
    const item = typeof id === 'string' ? items.get(id) : undefined;
    const median = positive(row['median']);
    const volume = positive(row['volume']);
    const datetime = row['datetime'];
    const day = typeof datetime === 'string' ? datetime.slice(0, 10) : undefined;
    if (!item || median === undefined || volume === undefined || !isDay(day)) continue;
    compact ??= { day, source: 'ducats', closed: {}, offers: {} };
    if (day === compact.day) compact.closed[`${item.path}|`] = [round1(median), volume];
  }
  return compact;
}

/**
 * Rückfall „Vollabruf“: `statistics_closed.90days` eines Items, nur die Tage `days`. Ergebnis pro Tag: Schlüssel →
 * [Median, Menge]. `undefined`, wenn die Antwort nicht lesbar ist.
 * @param {string} text
 * @param {string} path
 * @param {ReadonlySet<string>} days
 * @returns {Map<string, Record<string, [number, number]>> | undefined}
 */
export function statisticsDays(text, path, days) {
  const parsed = JSON.parse(text);
  const payload = isRecord(parsed) ? parsed['payload'] : undefined;
  const closed = isRecord(payload) ? payload['statistics_closed'] : undefined;
  const rows = isRecord(closed) && Array.isArray(closed['90days']) ? closed['90days'] : undefined;
  if (!rows) return undefined;
  /** @type {Map<string, Record<string, [number, number]>>} */
  const result = new Map();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const datetime = row['datetime'];
    const day = typeof datetime === 'string' ? datetime.slice(0, 10) : undefined;
    const median = positive(row['median']);
    const volume = positive(row['volume']);
    if (!day || !days.has(day) || median === undefined || volume === undefined) continue;
    const entries = result.get(day) ?? {};
    entries[`${path}|${variantKey(row)}`] = [round1(median), volume];
    result.set(day, entries);
  }
  return result;
}
