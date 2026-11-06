// @ts-check
// Belohnungen der Promo-Codes (#135) Items im Spiel zuordnen, über ihre englischen Namen: zuerst aus dem DE-Export
// (dieselbe Quelle wie die Bilder der App, Einträge mit `uniqueName` und `name`), als Rückfall aus public-export-plus
// (Export-Dateien mit `name` als Schlüssel ins Wörterbuch `dict.en`). Die App zeigt dann Namen in ihrer Sprache und das
// Bild aus dem DE-Export. Reine Funktionen ohne Abhängigkeiten.

/** Dateien des DE-Exports mit Items, die Promo-Codes bringen können (Booster stehen in `ExportSortieRewards`). */
export const DE_FILES = [
  'ExportSortieRewards',
  'ExportFlavour',
  'ExportCustoms',
  'ExportResources',
  'ExportWeapons',
  'ExportWarframes',
  'ExportSentinels',
  'ExportGear',
  'ExportUpgrades',
  'ExportKeys',
  'ExportDrones',
];

/** Dateien von public-export-plus (Rückfall); in dieser Reihenfolge gewinnt ein Name. */
export const PLUS_FILES = [
  'ExportBoosters',
  'ExportFlavour',
  'ExportCustoms',
  'ExportResources',
  'ExportWeapons',
  'ExportWarframes',
  'ExportSentinels',
  'ExportGear',
  'ExportUpgrades',
  'ExportArcanes',
  'ExportKeys',
  'ExportDrones',
];
export const PLUS_DICT = 'dict.en';

/**
 * @typedef {{ path: string, name: string, preferred: boolean }} NamedItem Item mit englischem Namen; `preferred` gewinnt
 *   bei gleichem Namen (DE: keine Blaupause, plus: mit Symbol).
 */

/** Vergleichsschlüssel: klein, nur Buchstaben und Ziffern („3-day“ = „3 Day“). @param {string} text */
export const nameKey = (text) =>
  text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Index Name → Pfade; bevorzugte Items zuerst, sonst in der Reihenfolge der Einträge.
 * @param {Iterable<NamedItem>} items @returns {Map<string, string[]>}
 */
export function indexFromItems(items) {
  /** @type {Map<string, { preferred: string[], other: string[] }>} */
  const found = new Map();
  for (const { path, name, preferred } of items) {
    const key = nameKey(name.replace(/<[^>]*>/g, ''));
    if (!key) continue;
    const paths = found.get(key) ?? { preferred: [], other: [] };
    found.set(key, paths);
    const list = preferred ? paths.preferred : paths.other;
    if (!list.includes(path)) list.push(path);
  }
  return new Map([...found].map(([key, paths]) => [key, [...paths.preferred, ...paths.other]]));
}

/**
 * Items aus Dateien des DE-Exports: jedes Objekt mit `uniqueName` (Lotus-Pfad) und `name`, auch verschachtelt.
 * @param {readonly unknown[]} files @returns {NamedItem[]}
 */
export function deItems(files) {
  /** @type {NamedItem[]} */
  const items = [];
  /** @param {unknown} value */
  const walk = (value) => {
    if (Array.isArray(value)) for (const entry of value) walk(entry);
    else if (isRecord(value)) {
      const path = value['uniqueName'];
      const name = value['name'];
      if (typeof path === 'string' && path.startsWith('/Lotus/') && typeof name === 'string') items.push({ path, name, preferred: !/\/Recipes\/|Blueprint$/.test(path) });
      for (const entry of Object.values(value)) if (typeof entry === 'object') walk(entry);
    }
  };
  for (const file of files) walk(file);
  return items;
}

/**
 * Items aus public-export-plus: Pfad → Eintrag mit `name` als Schlüssel ins Wörterbuch.
 * @param {readonly unknown[]} exports Inhalte der Dateien in `PLUS_FILES` @param {unknown} dict Inhalt von `dict.en`
 * @returns {NamedItem[]}
 */
export function plusItems(exports, dict) {
  if (!isRecord(dict)) return [];
  /** @type {NamedItem[]} */
  const items = [];
  for (const file of exports) {
    if (!isRecord(file)) continue;
    for (const [path, entry] of Object.entries(file)) {
      if (!path.startsWith('/Lotus/') || !isRecord(entry) || typeof entry['name'] !== 'string') continue;
      const name = dict[entry['name']];
      if (typeof name === 'string') items.push({ path, name, preferred: typeof entry['icon'] === 'string' });
    }
  }
  return items;
}

/** Index aus public-export-plus. @param {readonly unknown[]} exports @param {unknown} dict */
export const nameIndex = (exports, dict) => indexFromItems(plusItems(exports, dict));

/**
 * Namen, unter denen eine Belohnung im Spiel heissen kann: wie im Wiki; ohne Menge vorne („500 Orokin Ducats“); ohne Art
 * hinten („… Glyph“, „… decoration“, „… mod“), weil das Wiki sie oft anhängt.
 * @param {string} text @returns {string[]}
 */
export function nameCandidates(text) {
  const base = text.replace(/^(?:an?|the)\s+/i, '').trim();
  const withoutCount = base.replace(/^[\d,.]+\s*[x×]?\s+(?=\D)/i, '');
  const names = [base, withoutCount];
  for (const name of [base, withoutCount]) names.push(name.replace(/\s+(?:glyph|decoration|display|sigil|skin|emote|mod|item)$/i, ''));
  return [...new Set(names.filter(Boolean))];
}

/**
 * Pfad zu einer Belohnung, wenn ein Name passt; bei mehreren Items mit demselben Namen das erste bevorzugte.
 * `undefined` ohne Treffer.
 * @param {string} text @param {Map<string, string[]>} index @returns {string | undefined}
 */
export function rewardPath(text, index) {
  for (const name of nameCandidates(text)) {
    const path = index.get(nameKey(name))?.[0];
    if (path) return path;
  }
  return undefined;
}
