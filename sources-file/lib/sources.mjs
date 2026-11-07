// @ts-check
// Fundorte aus dem WARFRAME Wiki den Pfaden des Spiels zuordnen (#164). Reine Funktionen ohne Abhängigkeiten:
//   - Fragmente, Somachord-Lieder und Frame-Fighter-Fragmente → Ort (für das Modul Collectibles der App),
//   - Captura, Syandanas, Ephemeras und Sigils → Fundort als englischer Text mit grober Art (für das Item-Sheet),
//   - Händler-Manifeste ohne Namen → Name des Händlers im Wiki (über die angebotenen Items),
//   - Items der abgedeckten Arten ohne Eintrag → Liste „Fundort fehlt“.
// Pfade und Namen kommen aus dem DE-Export (Rückfall public-export-plus), die Listen der Fragmente aus public-export-plus.

import { nameKey } from '../../promo-codes-file/lib/rewards.mjs';
import { linkTargets, plain, section, tables, templates } from './wikitext.mjs';

/**
 * @typedef {'market' | 'baro' | 'varzia' | 'primeAccess' | 'event' | 'syndicate' | 'vendor' | 'nightwave' | 'quest' | 'drop' | 'tribute' | 'reward' | 'default' | 'unavailable' | 'other'} Kind
 * @typedef {{ k: Kind, t: string }} Source Grobe Art und englischer Text aus dem Wiki.
 * @typedef {{ place?: string, vendor?: string, how?: string }} SongSource
 * @typedef {{ path: string, name: string }} NamedPath
 * @typedef {{ found: Record<string, unknown>, unmatched: string[] }} Matched
 */

/** Längster Text pro Fundort; längere werden am ersten Satzende gekürzt. */
const MAX_TEXT = 160;

/** Arten in der Reihenfolge der Prüfung; die erste passende gewinnt. @type {readonly [Kind, RegExp][]} */
const CLASSIFY = [
  ['unavailable', /no longer (?:available|obtainable)|unobtainable|not currently obtainable|console[- ]exclusive|(?:PS4|XB1|Xbox|Switch)\S* Exclusive|Mixer Promo|^Originally\b/i],
  ['baro', /Baro Ki['’]?Teer/i],
  ['primeAccess', /Prime Access/i],
  ['varzia', /Varzia|Prime Resurgence/i],
  ['nightwave', /Nightwave/i],
  ['tribute', /Daily Tribute|login reward/i],
  // Vor Quest: „Purchased from Cephalon Suda offerings after completing the … quest“ ist ein Syndikats-Angebot.
  ['syndicate', /Standing|Syndicate|Steel Meridian|Arbiters of Hexis|Cephalon Suda|Perrin Sequence|Red Veil|New Loka|Conclave|Ostron|Solaris United|Entrati|Cavia|Holdfasts|Quills|Vox Solaris|Ventkids|The Hex|Cephalon Simaris|Necraloid/i],
  ['event', /\bevents?\b|Operation\b|Tactical Alert|Invasion|donation goal|Dog Days|Tennobaum/i],
  ['quest', /\bquest\b|upon completing|after completion of/i],
  ['market', /\bMarket\b|Platinum\b|\bBundle\b|Deluxe|Supporter Pack|Origin Pack/i],
  ['drop', /\bdrop(?:s|ped)?\b|Bounty|Rotation|Assassination|Stalker\b|Vanquish|Appears on (?:Kuva Liches|Sisters|Technocyte)|Defeat an? /i],
  ['vendor', /Purchas|Sold by|\bBought\b|Wares|Offerings|Honors|obtained from|Arbitration/i],
  ['default', /by default/i],
  ['tribute', /login gift/i],
  ['reward', /\bRewarded\b|\bAcquire an?\b/i],
];

/** Grobe Art eines Fundorts aus seinem Text. @param {string} text @returns {Kind} */
export function classify(text) {
  return CLASSIFY.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other';
}

/** Kürzt einen langen Text am ersten Satzende, sonst am Wort. @param {string} text */
export function shorten(text) {
  if (text.length <= MAX_TEXT) return text;
  const sentence = /^(.{20,}?[.!?])\s/.exec(text)?.[1];
  if (sentence && sentence.length <= MAX_TEXT) return sentence;
  return `${text.slice(0, MAX_TEXT - 1).replace(/\s+\S*$/, '')}…`;
}

/** Notizen in der Spalte des Erwerbs, die keinen Fundort nennen. */
const NOT_A_SOURCE = /^(?:Introduced in\b|When worn\b|N\/A$|[-–—?]$)/i;

/** Wörter für einen Erwerb, wenn die Art „other“ ist (sonst ist es eher eine Beschreibung des Items). */
const ACQUIRED = /obtain|award|purchas|reward|earn|exclusive|pack\b|promo|availab|complet|sold|gift|bundle|code|Twitch|Steam|Prime\b|login|Skins\b/i;

/** Fundort aus Wikitext; `undefined` ohne Text oder bei einer blossen Notiz. @param {string} wikitext @returns {Source | undefined} */
export function sourceOf(wikitext) {
  const text = shorten(plain(wikitext));
  return text && !NOT_A_SOURCE.test(text) ? { k: classify(text), t: text } : undefined;
}

/**
 * Pfade nach Namen (Schlüssel `nameKey`), nur solche mit `prefix`. Mehrere Pfade mit gleichem Namen bleiben zusammen.
 * @param {readonly NamedPath[]} items @param {readonly RegExp[]} prefixes @returns {Map<string, string[]>}
 */
export function pathsByName(items, prefixes) {
  /** @type {Map<string, string[]>} */
  const byName = new Map();
  for (const { path, name } of items) {
    if (!prefixes.some((prefix) => prefix.test(path))) continue;
    const key = nameKey(name.replace(/<[^>]*>/g, ''));
    if (!key) continue;
    const list = byName.get(key) ?? [];
    if (!list.includes(path)) list.push(path);
    byName.set(key, list);
  }
  return byName;
}

/** Erster Pfad zu einem der Namen. @param {Map<string, string[]>} byName @param {readonly string[]} names */
function pathOf(byName, names) {
  for (const name of names) {
    const paths = byName.get(nameKey(name));
    if (paths?.[0]) return paths;
  }
  return undefined;
}

// --- Collectibles ---

/**
 * Namen der Einträge einer Liste aus `ExportCodex` (public-export-plus): Pfad → englischer Name aus dem Wörterbuch.
 * @param {unknown} list z. B. `ExportCodex.loreFragments` @param {unknown} dict `dict.en` @returns {NamedPath[]}
 */
export function codexNames(list, dict) {
  if (typeof list !== 'object' || list === null || typeof dict !== 'object' || dict === null) return [];
  const words = /** @type {Record<string, unknown>} */ (dict);
  return Object.entries(list).flatMap(([path, entry]) => {
    const key = typeof entry === 'object' && entry !== null ? /** @type {Record<string, unknown>} */ (entry)['name'] : undefined;
    const name = typeof key === 'string' ? words[key] : undefined;
    return typeof name === 'string' && path.startsWith('/Lotus/') ? [{ path, name }] : [];
  });
}

/**
 * Ordner der Fragmente im Spiel (`/Lotus/Types/Lore/Fragments/<Ordner>/`) zu jeder Seite des Wikis. Hat eine Seite nur
 * einen Ort, gilt er für den ganzen Ordner: Manche Seiten nummerieren ihre Fragmente nur („1“ bis „5“ bei Solaris United)
 * oder kürzen die Namen („The Aftermath“ statt „Albrecht's Notes - The Aftermath“). Geprüft am 07.11.2026.
 */
export const SET_FOLDERS = /** @type {Readonly<Record<string, string>>} */ ({
  'Fragments/Fish': 'EidolonFragments',
  'Fragments/Glass': 'GlassFragments',
  'Fragments/Ghoul': 'GrineerGhoulFragments',
  'Fragments/Revenant': 'RevenantFragments',
  'Fragments/Solaris United': 'SolarisFragments',
  'Fragments/Partnership': 'GasCityFragments',
  'Fragments/The Tenets': 'CorpusReliefFragments',
  'Fragments/Duviri': 'DuviriFragments',
  'Fragments/Albrecht': 'AlbrectFragments',
  'Fragments/Isleweaver': 'DuviriMITWFragments',
});

/**
 * Ort der Lore-Fragmente aus den Seiten `Fragments/<Set>` (Vorlage `{{Fragments}}`, Felder `fragment` und `planet`):
 * zuerst über den Namen, dann für Seiten mit nur einem Ort über den Ordner (`SET_FOLDERS`).
 * @param {Readonly<Record<string, string>>} pages Titel → Wikitext @param {readonly NamedPath[]} fragments
 * @returns {{ found: Record<string, string>, unmatched: string[] }}
 */
export function fragmentPlaces(pages, fragments) {
  const byName = pathsByName(fragments, [/^\/Lotus\//]);
  /** @type {Record<string, string>} */
  const found = {};
  /** @type {string[]} */
  const unmatched = [];
  for (const [title, text] of Object.entries(pages)) {
    if (!title.startsWith('Fragments/')) continue;
    const entries = templates(text, 'Fragments').map(({ named }) => ({ name: plain(named['fragment'] ?? ''), place: plain(named['planet'] ?? '') })).filter((entry) => entry.name && entry.place);
    const places = new Set(entries.map((entry) => entry.place));
    const folder = Object.hasOwn(SET_FOLDERS, title) ? SET_FOLDERS[title] : undefined;
    const single = folder !== undefined && places.size === 1 ? [...places][0] : undefined;
    for (const { name, place } of entries) {
      const paths = pathOf(byName, [name]);
      if (!paths && !single) unmatched.push(name);
      for (const path of paths ?? []) found[path] = place;
    }
    if (single) for (const { path } of fragments) if (path.split('/').at(-2) === folder) found[path] ??= single;
  }
  return { found, unmatched };
}

/**
 * Somachord-Lieder aus der Seite `Somachord/Tones`: Ort des Fragments, Händler oder ein anderer Weg (Tabelle „Other“).
 * @param {string} text @param {readonly NamedPath[]} songs @returns {{ found: Record<string, SongSource>, unmatched: string[] }}
 */
export function songSources(text, songs) {
  const byName = pathsByName(songs, [/^\/Lotus\//]);
  /** @type {Record<string, SongSource>} */
  const found = {};
  /** @type {string[]} */
  const unmatched = [];
  for (const table of tables(text)) {
    const header = table.header.map((cell) => cell.toLowerCase());
    const songColumn = header.indexOf('song');
    if (songColumn < 0) continue;
    const vendorColumn = header.indexOf('vendor name');
    const placeColumn = header.indexOf('location');
    const howColumn = header.indexOf('requirements');
    for (const row of table.rows) {
      const cell = row[songColumn] ?? '';
      const names = [plain(cell), ...linkTargets(cell)];
      const paths = pathOf(byName, names);
      if (!paths) {
        if (names[0]) unmatched.push(names[0]);
        continue;
      }
      for (const path of paths) {
        const entry = found[path] ?? {};
        if (vendorColumn >= 0) entry.vendor ??= plain(row[vendorColumn] ?? '');
        else if (howColumn >= 0) entry.how ??= shorten(plain(row[howColumn] ?? ''));
        else if (placeColumn >= 0) entry.place ??= plain(row[placeColumn] ?? '');
        for (const key of /** @type {const} */ (['place', 'vendor', 'how'])) if (!entry[key]) delete entry[key];
        if (Object.keys(entry).length > 0) found[path] = entry;
      }
    }
  }
  return { found, unmatched };
}

/**
 * Frame-Fighter-Fragmente: Planet → Warframes aus der Seite `Frame Fighter` (Abschnitt „Frame Fighter Fragment Locations“).
 * `fighters`: Pfad des Fragments und Name seines Warframes (über `ExportCodex.fighterFrames[].suit`).
 * @param {string} text @param {readonly NamedPath[]} fighters @returns {{ found: Record<string, string>, unmatched: string[] }}
 */
export function fighterPlaces(text, fighters) {
  const byName = pathsByName(fighters, [/^\/Lotus\//]);
  /** @type {Record<string, string>} */
  const found = {};
  /** @type {string[]} */
  const unmatched = [];
  for (const table of tables(section(text, 'Frame Fighter Fragment Locations') ?? '')) {
    for (const row of table.rows) {
      const place = plain(row[0] ?? '');
      for (const { positional } of templates(row[1] ?? '', 'WF')) {
        const name = plain(positional[0] ?? '');
        const paths = pathOf(byName, [name]);
        if (!paths) unmatched.push(name);
        for (const path of paths ?? []) if (place) found[path] = place;
      }
    }
  }
  return { found, unmatched };
}

/**
 * Warframe-Name jedes Frame-Fighter-Fragments: `suit` aus `ExportCodex.fighterFrames`, Name aus dem DE-Export.
 * @param {unknown} list @param {ReadonlyMap<string, string>} names Pfad → Name @returns {NamedPath[]}
 */
export function fighterNames(list, names) {
  if (typeof list !== 'object' || list === null) return [];
  return Object.entries(list).flatMap(([path, entry]) => {
    const suit = typeof entry === 'object' && entry !== null ? /** @type {Record<string, unknown>} */ (entry)['suit'] : undefined;
    const name = typeof suit === 'string' ? names.get(suit) : undefined;
    return name ? [{ path, name }] : [];
  });
}

// --- Items ---

/** Arten der Items, die das Wiki abdeckt, nach Pfad im Spiel. */
export const CATEGORIES = /** @type {const} */ ({
  captura: [/^\/Lotus\/Types\/Items\/MiscItems\/PhotoboothTile/, /^\/Lotus\/Types\/Items\/PhotoBooth\//],
  sigils: [/^\/Lotus\/Upgrades\/Skins\/Sigils\//],
  syandanas: [/^\/Lotus\/Upgrades\/Skins\/Scarves\//],
  ephemeras: [/^\/Lotus\/Upgrades\/Skins\/Effects\//],
});

/**
 * Captura-Szenen der Seite `Captura` (Vorlage `{{SceneBox|Bild|Ort|Name|Kosten|Handelbar|Erwerb|Rang}}`).
 * @param {string} text @param {readonly NamedPath[]} items @returns {{ found: Record<string, Source[]>, unmatched: string[] }}
 */
export function capturaSources(text, items) {
  const byName = pathsByName(items, CATEGORIES.captura);
  /** @type {Record<string, Source[]>} */
  const found = {};
  /** @type {string[]} */
  const unmatched = [];
  for (const { positional } of templates(text, 'SceneBox')) {
    const name = plain(positional[2] ?? '');
    const how = positional[5] ?? '';
    const rank = plain(positional[6] ?? '').replace(/^icon=\S*$/, '');
    const source = sourceOf(rank && !/^\d/.test(rank) ? `${how} (${rank})` : how);
    if (!name || !source) continue;
    const paths = pathOf(byName, [name]);
    if (!paths) unmatched.push(name);
    for (const path of paths ?? []) found[path] ??= [source];
  }
  return { found, unmatched };
}

/**
 * Tabellen einer Seite wie `Syandana` oder `Ephemera`: Name in der ersten Spalte, Erwerb in der letzten (Kopf
 * „Acquisition“, „Bundle“ oder „Warframe“). Steht dort nur ein Paket, heisst der Text „Bundle: …“.
 * @param {string} text @param {readonly NamedPath[]} items @param {readonly RegExp[]} prefixes
 * @returns {{ found: Record<string, Source[]>, unmatched: string[] }}
 */
export function tableSources(text, items, prefixes) {
  const byName = pathsByName(items, prefixes);
  /** @type {Record<string, Source[]>} */
  const found = {};
  /** @type {string[]} */
  const unmatched = [];
  for (const table of tables(text)) {
    const last = (table.header.at(-1) ?? '').toLowerCase();
    if (!['acquisition', 'bundle', 'warframe'].includes(last)) continue;
    /** @type {Source | undefined} */
    let above;
    for (const row of table.rows) {
      const first = row[0] ?? '';
      const name = linkTargets(first).at(-1) ?? plain(first);
      // Eine kürzere Zeile teilt sich die letzte Zelle mit der Zeile darüber (`rowspan`); ihre letzte Zelle ist dann
      // eine andere Spalte (z. B. die Beschreibung).
      let source = row.length >= table.header.length ? sourceOf(row.at(-1) ?? '') : above;
      // Ohne erkennbare Art und ohne Wort für einen Erwerb ist es eher eine Beschreibung als ein Fundort.
      if (source?.k === 'other' && !ACQUIRED.test(source.t)) source = undefined;
      if (row.length >= table.header.length) above = source;
      if (!name || !source || row.length < 2) continue;
      if (last === 'bundle' && source.k === 'other') source = { k: 'market', t: shorten(`Bundle: ${source.t}`) };
      const paths = pathOf(byName, [name, plain(first)]);
      if (!paths) unmatched.push(name);
      for (const path of paths ?? []) found[path] ??= [source];
    }
  }
  return { found, unmatched };
}

/** Lua-Tabelle: Einträge `["Schlüssel"] = { … }` auf einer Ebene (Einrückung `indent` Tabs). @param {string} text @param {number} indent */
function luaEntries(text, indent) {
  const tabs = '\t'.repeat(indent);
  /** @type {{ key: string, body: string }[]} */
  const entries = [];
  const pattern = new RegExp(`^${tabs}\\["((?:[^"\\\\]|\\\\.)+)"\\]\\s*=\\s*\\{([\\s\\S]*?)^${tabs}\\},?\\s*$`, 'gm');
  for (const match of text.matchAll(pattern)) entries.push({ key: (match[1] ?? '').replace(/\\(.)/g, '$1'), body: match[2] ?? '' });
  return entries;
}

/** Zeichenkette eines Felds in einem Lua-Eintrag. @param {string} body @param {string} field */
function luaString(body, field) {
  const match = new RegExp(`(?:^|[\\s,{])${field}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'm').exec(body);
  return match?.[1]?.replace(/\\(.)/g, '$1');
}

/** Art und Text zu einem Anker der Seite „Sigils“, z. B. `Event Sigils` → Event. @param {string} anchor @returns {Source} */
export function sigilSource(anchor) {
  const text = anchor.replace(/_/g, ' ').replace(/\s*Sigils?$/i, '').trim();
  if (/Enemy Drop/i.test(text)) return { k: 'drop', t: 'Enemy drop' };
  if (/Purchasable/i.test(text)) return { k: 'market', t: 'Market' };
  if (/Founder/i.test(text)) return { k: 'unavailable', t: 'Founders Program' };
  if (/PS4|XBox|Switch|Console/i.test(text)) return { k: 'unavailable', t: text };
  return { k: classify(text), t: text };
}

/**
 * Sigils aus `Module:Sigils/data`: Name und Anker der Quelle (`Link = "Sigils#Event Sigils"`).
 * @param {string} module @param {readonly NamedPath[]} items @returns {{ found: Record<string, Source[]>, unmatched: string[] }}
 */
export function sigilSources(module, items) {
  const byName = pathsByName(items, CATEGORIES.sigils);
  /** @type {Record<string, Source[]>} */
  const found = {};
  /** @type {string[]} */
  const unmatched = [];
  for (const { key, body } of luaEntries(module, 1)) {
    const link = luaString(body, 'Link');
    const anchor = link?.split('#').filter(Boolean).slice(1).join('#');
    // „Other Sigils“ nennt keinen Fundort.
    if (!anchor || /^Other\b/i.test(anchor)) continue;
    const name = luaString(body, 'Name') ?? key;
    const paths = pathOf(byName, [name, key]);
    if (!paths) unmatched.push(name);
    for (const path of paths ?? []) found[path] ??= [sigilSource(anchor)];
  }
  return { found, unmatched };
}

// --- Händler ---

/**
 * Händler aus `Module:Vendors/data`: Name und Namen der Angebote (auskommentierte Zeilen zählen nicht).
 * @param {string} module @returns {{ name: string, offers: Set<string> }[]}
 */
export function wikiVendors(module) {
  const body = /\bVendors\s*=\s*\{([\s\S]*)/.exec(module)?.[1] ?? '';
  return luaEntries(body, 2).map(({ key, body: entry }) => {
    const offers = new Set(
      entry
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith('--'))
        .flatMap((line) => [...line.matchAll(/\{\s*"((?:[^"\\]|\\.)+)"\s*,\s*"/g)].map((match) => nameKey(match[1] ?? ''))),
    );
    // Der Name des Händlers steht in `Link` (Seite ohne Anker und Klammer: „Otak#Unearth_Citrine“ → Otak,
    // „Loid (Original)#Research Dante“ → Loid); `Name` ist oft der Name des Angebots.
    const page = luaString(entry, 'Link')?.split('#')[0]?.replace(/\s*\([^)]*\)\s*$/, '').trim();
    return { name: page || luaString(entry, 'Name') || key, offers };
  });
}

/**
 * Name des Händlers zu jedem Manifest aus `ExportVendors` (public-export-plus): der Händler im Wiki, der die meisten Items
 * des Manifests anbietet, wenn es mindestens 3 und mehr als die Hälfte der benannten Items sind und kein zweiter gleich
 * viele hat. Schlüssel ohne `/Lotus/Types/Game/VendorManifests/`.
 * @param {string} module @param {unknown} vendors @param {ReadonlyMap<string, string>} names Pfad → Name
 * @returns {Record<string, string>}
 */
export function vendorNames(module, vendors, names) {
  const wiki = wikiVendors(module);
  /** @type {Record<string, string>} */
  const found = {};
  if (typeof vendors !== 'object' || vendors === null) return found;
  for (const [manifest, value] of Object.entries(vendors)) {
    const items = typeof value === 'object' && value !== null ? /** @type {Record<string, unknown>} */ (value)['items'] : undefined;
    if (!Array.isArray(items)) continue;
    const keys = new Set(
      items.flatMap((item) => {
        const store = typeof item === 'object' && item !== null ? /** @type {Record<string, unknown>} */ (item)['storeItem'] : undefined;
        const name = typeof store === 'string' ? names.get(store.replace('/StoreItems/', '/')) : undefined;
        return name ? [nameKey(name)] : [];
      }),
    );
    if (keys.size === 0) continue;
    const scores = wiki.map(({ name, offers }) => ({ name, score: [...keys].filter((key) => offers.has(key)).length })).sort((a, b) => b.score - a.score);
    const [best, second] = scores;
    if (best && best.score >= 3 && best.score * 2 > keys.size && (second?.score ?? 0) < best.score) found[manifest.replace(/^\/Lotus\/Types\/Game\/VendorManifests\//, '')] = best.name;
  }
  return found;
}

// --- Fehlende ---

/**
 * @typedef {{ path: string, name: string, since: string }} MissingItem `since`: Tag, an dem es zuerst ohne Eintrag war.
 * @typedef {{ total: number, missing: MissingItem[] }} MissingCategory
 */

/**
 * Items einer Art ohne Eintrag, sortiert nach Pfad. `since` bleibt aus dem vorigen Stand, neue bekommen `today`.
 * @param {readonly NamedPath[]} items alle Items der Art @param {ReadonlySet<string>} covered Pfade mit Eintrag
 * @param {readonly MissingItem[] | undefined} previous @param {string} today @returns {MissingCategory}
 */
export function missingIn(items, covered, previous, today) {
  const since = new Map((previous ?? []).map((item) => [item.path, item.since]));
  // Ohne Namen ist es kein Item, das ein Spieler sucht (z. B. Platzhalter im Export).
  const unique = new Map(items.filter((item) => item.name.trim()).map((item) => [item.path, item.name.trim()]));
  const missing = [...unique]
    .filter(([path]) => !covered.has(path))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, name]) => ({ path, name, since: since.get(path) ?? today }));
  return { total: unique.size, missing };
}

/**
 * Kurzer Bericht für ein GitHub-Issue: Items, die seit `from` ohne Eintrag sind, pro Art. Leer, wenn es keine gibt.
 * @param {Readonly<Record<string, MissingCategory>>} categories @param {string} from @returns {string}
 */
export function missingReport(categories, from) {
  const lines = [];
  for (const [category, { missing }] of Object.entries(categories)) {
    const fresh = missing.filter((item) => item.since >= from);
    if (fresh.length === 0) continue;
    lines.push(`### ${category} (${fresh.length})`, '', ...fresh.slice(0, 50).map((item) => `- ${item.name} \`${item.path}\` (since ${item.since})`));
    if (fresh.length > 50) lines.push(`- … and ${fresh.length - 50} more`);
    lines.push('');
  }
  return lines.length === 0 ? '' : ['Items without a source in `sources/v1/` since ' + from + ':', '', ...lines].join('\n');
}

