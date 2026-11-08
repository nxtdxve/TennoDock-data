// @ts-check
// Spannen der Riven-Preise (#172) wie in der App für #55 (`src/modules/rivens/domain/value.ts`): nur Sofortkauf, geändert
// seit dem Hotfix vom 22.10.2026 und höchstens 60 Tage alt, Witzpreise weg, Spanne vom 25. bis 60. Perzentil, gerundet.
// Die Schwellen (ab 8 sicher, 5 bis 7 grob) wendet die App an; die Datei enthält Einträge ab 5 Angeboten.

/** @typedef {import('./rules.mjs').WeaponClass} WeaponClass */
/**
 * Ein Angebot, eingeordnet; ohne Verkäufer und ohne Kennung der Auktion in der Datei.
 * @typedef {{ id: string, price: number, buffs: string[], curse?: string, updated: number, luck?: number }} Offer
 *   `buffs`: Tags der Vorteile, sortiert; `curse`: Tag des Nachteils.
 * @typedef {[number, number, number] | [number, number, number, number[] | 0] | [number, number, number, number[] | 0, 0 | 1] | [number, number, number, number[] | 0, 0 | 1, Record<string, [number, number, number]>]} Entry
 *   `[tief, hoch, Anzahl, [p10, Median, p90] oder 0, unvollständig, Glücks-Fenster]`, hinten Gekürztes gilt als 0 bzw. fehlt.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Hotfix 44.1.3: seither gilt für alle Waffen dieselbe Disposition; ältere Angebote zählen nicht. */
export const SINCE = '2026-10-22';
export const MAX_AGE_DAYS = 60;
export const RANGE = /** @type {const} */ ([0.25, 0.6]);
export const MIN_RANGE = 8;
export const MIN_UNSURE = 5;
export const LUCK_WINDOW = 0.2;
/** Mitten der Glücks-Fenster (× 10 als Schlüssel der Datei). */
export const LUCK_CENTERS = [1, 3, 5, 7, 9];
/** Fenster nur für Einträge mit so vielen Angeboten (sonst hat kein Fenster 8). */
export const WINDOW_MIN = 16;

/** Perzentil einer aufsteigend sortierten Liste, linear zwischen den Nachbarn. @param {readonly number[]} sorted @param {number} p */
export function percentile(sorted, p) {
  if (sorted.length === 0) return undefined;
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const below = Math.floor(position);
  const low = sorted[below] ?? 0;
  const high = sorted[Math.min(sorted.length - 1, below + 1)] ?? low;
  return low + (high - low) * (position - below);
}

/**
 * Witzpreise weg: über Q3 + 1,5 × IQR, aber nie unter dem doppelten Median; unter 4 Angeboten bleibt alles.
 * @template {{ price: number }} T @param {readonly T[]} offers @returns {T[]}
 */
export function withoutOutliers(offers) {
  if (offers.length < 4) return [...offers];
  const prices = offers.map((offer) => offer.price).sort((a, b) => a - b);
  const q1 = percentile(prices, 0.25) ?? 0;
  const q3 = percentile(prices, 0.75) ?? 0;
  const limit = Math.max(q3 + 1.5 * (q3 - q1), 2 * (percentile(prices, 0.5) ?? 0));
  return offers.filter((offer) => offer.price <= limit);
}

/** Platin für die Anzeige: unter 100 ganz, bis 1'000 auf 5, bis 10'000 auf 10, darüber auf 50. @param {number} value */
export function roundPlatinum(value) {
  const step = value < 100 ? 1 : value < 1000 ? 5 : value < 10000 ? 10 : 50;
  return Math.max(1, Math.round(value / step) * step);
}

/** Spanne aus Preisen (25. bis 60. Perzentil), gerundet. @param {readonly number[]} prices @returns {[number, number] | undefined} */
export function priceRange(prices) {
  const sorted = [...prices].sort((a, b) => a - b);
  const low = percentile(sorted, RANGE[0]);
  const high = percentile(sorted, RANGE[1]);
  if (low === undefined || high === undefined) return undefined;
  const a = roundPlatinum(low);
  const b = roundPlatinum(high);
  return [a, Math.max(a, b)];
}

/** Geändert seit dem Hotfix, höchstens 60 Tage alt; ein Datum aus der Zukunft zählt bis einen Tag. @param {number} updated @param {number} now */
export function isFresh(updated, now) {
  return updated >= Date.parse(`${SINCE}T00:00:00Z`) && now - updated <= MAX_AGE_DAYS * DAY_MS && updated <= now + DAY_MS;
}

/**
 * Eintrag einer Gruppe ähnlicher Angebote; `undefined` unter 5 nach dem Witzpreis-Filter. Ab 8 mit p10, Median und p90 für
 * das Sheet. Ab 16 Angeboten Spannen für Glücks-Fenster (±0,2 um 0,1 … 0,9), wenn ein Fenster ohne Witzpreise noch 8 hat;
 * erst das Glück, dann die Witzpreise (Review N2 zu #55: God Rolls fielen sonst unter allen als Witzpreise weg).
 * @param {readonly Offer[]} group @param {boolean} partial @returns {Entry | undefined}
 */
export function buildEntry(group, partial) {
  const cleaned = withoutOutliers(group);
  if (cleaned.length < MIN_UNSURE) return undefined;
  const prices = cleaned.map((offer) => offer.price).sort((a, b) => a - b);
  const range = priceRange(prices);
  if (!range) return undefined;
  const spread = cleaned.length >= MIN_RANGE ? [0.1, 0.5, 0.9].map((p) => roundPlatinum(percentile(prices, p) ?? 0)) : 0;
  /** @type {Record<string, [number, number, number]>} */
  const windows = {};
  if (group.length >= WINDOW_MIN) {
    for (const center of LUCK_CENTERS) {
      const near = group.filter((offer) => offer.luck !== undefined && Math.abs(offer.luck - center / 10) <= LUCK_WINDOW + 1e-9);
      if (near.length < MIN_RANGE) continue;
      const kept = withoutOutliers(near);
      const windowRange = kept.length >= MIN_RANGE ? priceRange(kept.map((offer) => offer.price)) : undefined;
      if (windowRange) windows[String(center)] = [windowRange[0], windowRange[1], kept.length];
    }
  }
  if (Object.keys(windows).length > 0) return [range[0], range[1], cleaned.length, spread, partial ? 1 : 0, windows];
  if (partial) return [range[0], range[1], cleaned.length, spread, 1];
  return spread ? [range[0], range[1], cleaned.length, spread] : [range[0], range[1], cleaned.length];
}

/**
 * Einträge einer Waffe aus allen Angeboten ihrer Paar-Suchen. Schlüssel `<Indizes der Vorteile>|<Klasse>`; Stufe 2 mit `*`
 * (drei Vorteile, darunter das Paar). `searched`: Paare mit Vollständigkeit; eine genaue Gruppe ist vollständig, wenn
 * irgendein gesuchtes Paar darin vollständig war.
 * @param {readonly Offer[]} offers frisch, mit bekannten Tags, ohne Doppel
 * @param {readonly { pair: [string, string], complete: boolean }[]} searched
 * @param {(tag: string | undefined) => 'n' | 'h' | 's'} classOfCurse
 * @param {(tag: string) => number} indexOf Index des Tags in `stats` der Datei
 * @returns {Record<string, Entry>}
 */
export function weaponEntries(offers, searched, classOfCurse, indexOf) {
  const keyOf = (/** @type {readonly string[]} */ tags) => tags.map(indexOf).sort((a, b) => a - b).join('.');
  /** @type {Map<string, { offers: Offer[], partial: boolean }>} */
  const groups = new Map();
  const add = (/** @type {string} */ key, /** @type {Offer} */ offer, /** @type {boolean} */ partial) => {
    const group = groups.get(key) ?? { offers: [], partial };
    group.offers.push(offer);
    groups.set(key, group);
  };
  for (const offer of offers) {
    const covering = searched.filter(({ pair }) => pair.every((tag) => offer.buffs.includes(tag)));
    if (covering.length === 0) continue;
    const curse = classOfCurse(offer.curse);
    add(`${keyOf(offer.buffs)}|${curse}`, offer, !covering.some((entry) => entry.complete));
    if (offer.buffs.length !== 3) continue;
    for (const { pair, complete } of covering) add(`*${keyOf(pair)}|${curse}`, offer, !complete);
  }
  /** @type {Record<string, Entry>} */
  const entries = {};
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key);
    const entry = group ? buildEntry(group.offers, group.partial) : undefined;
    if (entry) entries[key] = entry;
  }
  return entries;
}
