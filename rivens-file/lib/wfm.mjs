// @ts-check
// Riven-Auktionen von warframe.market (#172), nur lesen: Listen der Waffen und Eigenschaften aus v2, die Suche aus v1 (in
// v2 gibt es keine Auktionen, Doku v0.25.0). Höchstens 100 Treffer pro Suche; bei 100 teilt die Action die Suche nach den
// drei Polaritäten (ohne Einfluss auf den Preis) und holt in einem vollen Teil zusätzlich die teuersten. Verkäufer, Kennung
// des Verkäufers und Notizen werden nie gelesen. Regeln: eigener User-Agent, Vertrags-Suche höchstens 10 bis 20 pro
// Minute (Doku `rules/overview.md`); die Action fragt alle 8 s.

export const WFM = 'https://api.warframe.market';
export const WEAPONS_URL = `${WFM}/v2/riven/weapons`;
export const ATTRIBUTES_URL = `${WFM}/v2/riven/attributes`;
export const SEARCH_LIMIT = 100;
export const POLARITIES = /** @type {const} */ (['madurai', 'naramon', 'vazarin']);

/**
 * @typedef {{ slug: string, path: string, name: string, group?: string, rivenType?: string }} WfmWeapon `path` ohne `/Lotus/`.
 * @typedef {{ id: string, price: number, rank?: number, updated?: number, values: { slug: string, value: number, positive: boolean }[] }} Auction
 * @typedef {{ list: Auction[], total: number } | { failed: string }} SearchAnswer `total`: Treffer der Antwort vor dem Filter (Grenze 100).
 * @typedef {(url: string) => Promise<SearchAnswer>} Search Eine Suche mit Abstand, Budget und Wiederholung (`build.mjs`).
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Hülle `{ data }` von v2. @param {string} text @returns {unknown[] | undefined} */
function envelope(text) {
  const json = JSON.parse(text);
  return isRecord(json) && Array.isArray(json['data']) ? json['data'] : undefined;
}

/** `/v2/riven/weapons`: Slug, Waffenpfad (`gameRef`), englischer Name, Gruppe und Riven-Typ. @param {string} text @returns {WfmWeapon[] | undefined} */
export function parseWeapons(text) {
  const list = envelope(text);
  if (!list) return undefined;
  const weapons = list.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const { slug, gameRef, group, rivenType } = entry;
    const en = isRecord(entry['i18n']) && isRecord(entry['i18n']['en']) ? entry['i18n']['en'] : undefined;
    const name = typeof en?.['name'] === 'string' ? en['name'] : undefined;
    if (typeof slug !== 'string' || typeof gameRef !== 'string' || !gameRef.startsWith('/Lotus/') || name === undefined) return [];
    /** @type {WfmWeapon} */
    const weapon = { slug, path: gameRef.slice('/Lotus/'.length), name };
    if (typeof group === 'string') weapon.group = group;
    if (typeof rivenType === 'string') weapon.rivenType = rivenType;
    return [weapon];
  });
  return weapons.length > 0 ? weapons : undefined;
}

/** `/v2/riven/attributes`: Slug ↔ Tag wie im Spielstand (`gameRef`). @param {string} text @returns {Map<string, string> | undefined} */
export function parseAttributes(text) {
  const list = envelope(text);
  if (!list) return undefined;
  /** @type {Map<string, string>} */
  const tags = new Map();
  for (const entry of list) if (isRecord(entry) && typeof entry['slug'] === 'string' && typeof entry['gameRef'] === 'string') tags.set(entry['slug'], entry['gameRef']);
  return tags.size > 0 ? tags : undefined;
}

/**
 * `/v1/auctions/search`: offene, sichtbare Auktionen mit Sofortkauf, dazu die Zahl der Treffer vor dem Filter (für die
 * Grenze von 100). Ohne Verkäufer (`owner`), ohne Notiz, ohne Gebote. `undefined`, wenn die Antwort keine Liste hat.
 * @param {string} text @returns {{ list: Auction[], total: number } | undefined}
 */
export function parseAuctionPage(text) {
  const json = JSON.parse(text);
  const payload = isRecord(json) && isRecord(json['payload']) ? json['payload'] : undefined;
  if (!payload || !Array.isArray(payload['auctions'])) return undefined;
  const list = payload['auctions'].flatMap((value) => {
    if (!isRecord(value) || value['closed'] === true || value['visible'] === false) return [];
    const item = isRecord(value['item']) ? value['item'] : undefined;
    const price = value['buyout_price'];
    if (typeof value['id'] !== 'string' || !item || typeof price !== 'number' || !(price > 0)) return [];
    const values = (Array.isArray(item['attributes']) ? item['attributes'] : []).flatMap((entry) =>
      isRecord(entry) && typeof entry['url_name'] === 'string' && typeof entry['value'] === 'number' && Number.isFinite(entry['value']) ? [{ slug: entry['url_name'], value: entry['value'], positive: entry['positive'] !== false }] : [],
    );
    /** @type {Auction} */
    const auction = { id: value['id'], price, values };
    if (typeof item['mod_rank'] === 'number') auction.rank = item['mod_rank'];
    const updated = typeof value['updated'] === 'string' ? Date.parse(value['updated']) : typeof value['created'] === 'string' ? Date.parse(value['created']) : NaN;
    if (Number.isFinite(updated)) auction.updated = updated;
    return [auction];
  });
  return { list, total: payload['auctions'].length };
}

/** Nur die Auktionen (`parseAuctionPage`). @param {string} text @returns {Auction[] | undefined} */
export const parseAuctions = (text) => parseAuctionPage(text)?.list;

/**
 * Adresse einer Suche: Waffe, beide Vorteile (die Suche liefert Auktionen, die beide enthalten), optional Polarität und
 * „teuerste zuerst“.
 * @param {string} weaponSlug @param {readonly string[]} positive @param {{ polarity?: string, desc?: boolean }} [options]
 */
export function searchUrl(weaponSlug, positive, options = {}) {
  const params = [`type=riven`, `weapon_url_name=${encodeURIComponent(weaponSlug)}`, `positive_stats=${positive.map(encodeURIComponent).join(',')}`];
  if (options.polarity) params.push(`polarity=${options.polarity}`);
  params.push(`sort_by=${options.desc ? 'price_desc' : 'price_asc'}`);
  return `${WFM}/v1/auctions/search?${params.join('&')}`;
}

/**
 * Alle Auktionen mit einem Paar von Vorteilen. Unter 100 Treffern reicht eine Suche. Bei 100 je Polarität (`big`: aus dem
 * letzten Lauf bekannt, dann gleich geteilt); ist ein Teil wieder voll, dazu die teuersten dieses Teils. Überschneiden
 * sich die beiden nicht, fehlt die Mitte: `complete` false. `failed`: eine Suche ist gescheitert, das Paar zählt nicht.
 * @param {Search} search @param {string} weaponSlug @param {readonly string[]} positive @param {boolean} big
 * @returns {Promise<{ auctions: Auction[], complete: boolean, big: boolean } | { failed: string }>}
 */
export async function searchPair(search, weaponSlug, positive, big) {
  if (!big) {
    const first = await search(searchUrl(weaponSlug, positive));
    if ('failed' in first) return first;
    if (first.total < SEARCH_LIMIT) return { auctions: first.list, complete: true, big: false };
  }
  /** @type {Map<string, Auction>} */
  const seen = new Map();
  let complete = true;
  for (const polarity of POLARITIES) {
    const cheapest = await search(searchUrl(weaponSlug, positive, { polarity }));
    if ('failed' in cheapest) return cheapest;
    for (const auction of cheapest.list) seen.set(auction.id, auction);
    if (cheapest.total < SEARCH_LIMIT) continue;
    const dearest = await search(searchUrl(weaponSlug, positive, { polarity, desc: true }));
    if ('failed' in dearest) return dearest;
    const ids = new Set(cheapest.list.map((auction) => auction.id));
    if (dearest.total >= SEARCH_LIMIT && !dearest.list.some((auction) => ids.has(auction.id))) complete = false;
    for (const auction of dearest.list) seen.set(auction.id, auction);
  }
  return { auctions: [...seen.values()], complete, big: seen.size >= SEARCH_LIMIT };
}
