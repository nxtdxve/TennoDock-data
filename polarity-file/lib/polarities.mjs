// @ts-check
// Eingebaute Polaritäten der Warframes, Waffen und Begleiter aus WFCD/warframe-items (MIT), umgerechnet in die Namen der
// App (`AP_*` wie im Spielstand). Reine Funktionen; der Abruf steht in build.mjs.

/** WFCD-Name (aus dem WARFRAME Wiki) → Polarität im Spielstand. „aura“ und „universal“ heissen im Wiki die universelle
 *  Polarität (Aura-, Stance- und Omni-Forma), im Spielstand `AP_ANY`. */
export const POLARITY_NAMES = /** @type {const} */ ({
  madurai: 'AP_ATTACK',
  vazarin: 'AP_DEFENSE',
  naramon: 'AP_TACTIC',
  zenurik: 'AP_POWER',
  unairu: 'AP_WARD',
  penjaga: 'AP_PRECEPT',
  umbra: 'AP_UMBRA',
  aura: 'AP_ANY',
  universal: 'AP_ANY',
});

/** Dateien von WFCD mit Items, die Mod-Plätze haben. */
export const SOURCE_FILES = ['Warframes', 'Primary', 'Secondary', 'Melee', 'Arch-Gun', 'Arch-Melee', 'Archwing', 'Pets', 'Sentinels', 'SentinelWeapons'];

/**
 * @typedef {{ p?: string[], pm?: number[], a?: string | string[], x?: string, s?: string }} Entry
 *   `p` eingebaute Polaritäten der Mod-Plätze (Reihenfolge wie im Wiki), `pm` ihr Platz ab Werk in derselben Reihenfolge
 *   (#194, aus positions.json; fehlt, solange er nicht bekannt ist), `a` Aura (Jade: zwei Plätze), `x` Exilus, `s` Haltung.
 */

/** @param {unknown} value @returns {string | undefined} */
export function polarityOf(value) {
  if (typeof value !== 'string') return undefined;
  return /** @type {Record<string, string>} */ (POLARITY_NAMES)[value.trim().toLowerCase()];
}

/** @param {unknown} value @returns {string[]} */
function polarityList(value) {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.map(polarityOf).filter(/** @returns {p is string} */ (p) => p !== undefined);
}

/**
 * Ein Item aus WFCD → Eintrag; ohne bekannte Polarität `undefined`. Unbekannte Namen fallen weg (kein Raten).
 * @param {Record<string, unknown>} item
 * @returns {Entry | undefined}
 */
export function entryOf(item) {
  /** @type {Entry} */
  const entry = {};
  const mods = polarityList(item['polarities']);
  if (mods.length > 0) entry.p = mods;
  const aura = polarityList(item['aura']);
  if (aura.length === 1) entry.a = /** @type {string} */ (aura[0]);
  else if (aura.length > 1) entry.a = aura;
  const exilus = polarityOf(item['exilusPolarity']);
  if (exilus) entry.x = exilus;
  const stance = polarityOf(item['stancePolarity']);
  if (stance) entry.s = stance;
  return Object.keys(entry).length > 0 ? entry : undefined;
}

/**
 * Alle Dateien → Tabelle nach Lotus-Pfad (`uniqueName`), sortiert, damit derselbe Stand dieselbe Datei ergibt.
 * @param {unknown[][]} lists Inhalt der Dateien aus `SOURCE_FILES`
 * @returns {Record<string, Entry>}
 */
export function polarityTable(lists) {
  /** @type {Map<string, Entry>} */
  const table = new Map();
  for (const list of lists) {
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw || typeof raw !== 'object') continue;
      const item = /** @type {Record<string, unknown>} */ (raw);
      const path = item['uniqueName'];
      if (typeof path !== 'string' || !path.startsWith('/Lotus/')) continue;
      const entry = entryOf(item);
      if (entry) table.set(path, entry);
    }
  }
  return Object.fromEntries([...table.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Plätze ab Werk (#194): höchstens so viele Mod-Plätze hat ein Item (Necramech). */
export const MAX_MOD_SLOTS = 12;

/**
 * Mod-Plätze pro Art (TennoDock #27, Paket-Doku 1.2): Begleiter 10, Necramech 12 (`productCategory` `MechSuits` in der Datei
 * Warframes), sonst 8. Dient als Grenze für `pm` (Review #194, S3).
 * @param {string} file Datei aus `SOURCE_FILES` @param {Record<string, unknown>} item
 */
export function modSlotCount(file, item) {
  if (file === 'Pets' || file === 'Sentinels') return 10;
  if (file === 'Warframes' && item['productCategory'] === 'MechSuits') return 12;
  return 8;
}

/**
 * Mod-Plätze pro Lotus-Pfad, aus denselben Dateien wie `polarityTable`.
 * @param {unknown[][]} lists Inhalt der Dateien in der Reihenfolge von `SOURCE_FILES`
 * @returns {Record<string, number>}
 */
export function slotCounts(lists) {
  /** @type {Record<string, number>} */
  const counts = {};
  lists.forEach((list, index) => {
    const file = SOURCE_FILES[index] ?? '';
    for (const raw of Array.isArray(list) ? list : []) {
      if (!raw || typeof raw !== 'object') continue;
      const item = /** @type {Record<string, unknown>} */ (raw);
      if (typeof item['uniqueName'] === 'string') counts[item['uniqueName']] = modSlotCount(file, item);
    }
  });
  return counts;
}
export const POSITIONS_FORMAT = 'tennodock-polarity-positions';

/**
 * @typedef {{ p: string[], pm: number[], wfcd?: string[] | null, a?: string | string[], x?: string, s?: string, source: string, date: string, note?: string }} PositionEntry
 *   Plätze ab Werk eines Items: `p` die Liste, zu der die Plätze gehören (wie beim Eintragen), `pm` der Platz jeder
 *   Polarität aus `p` (0 = unten rechts im Raster des Spiels), dazu Quelle und Datum.
 *   Ersatz (#213): Mit `wfcd` ersetzt der Eintrag die Liste von WFCD (`wfcd` = die Liste von WFCD beim Eintragen, `null`
 *   wenn WFCD keine nennt oder das Item gar nicht kennt). `p` darf dann leer sein (keine eingebauten Mod-Polaritäten).
 *   `a` legt die Reihenfolge der Aura-Plätze fest (Jade), bei gleicher Menge wie WFCD. `x` und `s` nur für Items, die WFCD
 *   gar nicht kennt.
 */

/** @param {unknown} value @param {number} limit @returns {value is number[]} */
function slotList(value, limit) {
  return Array.isArray(value) && value.every((slot) => Number.isInteger(slot) && slot >= 0 && slot < limit) && new Set(value).size === value.length;
}

/** @param {unknown} value */
const isPolarity = (value) => typeof value === 'string' && Object.values(POLARITY_NAMES).includes(/** @type {never} */ (value));
/** @param {unknown} value @returns {string[] | undefined} */
const polarityArray = (value) => (Array.isArray(value) && value.every(isPolarity) ? /** @type {string[]} */ (value) : undefined);
/** @param {unknown} value @returns {string[]} */
const asList = (value) => (Array.isArray(value) ? value : value === undefined ? [] : [value]);
/** @param {unknown[]} a @param {unknown[]} b */
const sameSet = (a, b) => JSON.stringify([...a].map(String).sort()) === JSON.stringify([...b].map(String).sort());

/**
 * Plätze ab Werk aus `positions.json` in die Tabelle (#194). `pm` nur, wenn der Eintrag zur heutigen Liste von WFCD passt
 * (gleiche Polaritäten in gleicher Reihenfolge) und jede Polarität genau einen eigenen Platz hat. Sonst fällt er weg; die
 * Meldung nennt den Pfad (z. B. nach einem Rework, wenn WFCD die Liste ändert).
 * Ersatz (#213, Feld `wfcd`): `p` und `pm` des Eintrags gelten statt der Liste von WFCD, solange WFCD noch dieselbe Liste
 * nennt wie beim Eintragen (`null`: keine). Ändert WFCD sie, fällt der Ersatz weg (Meldung), und es gilt wieder WFCD.
 * @param {Record<string, Entry>} items Tabelle aus `polarityTable`, wird nicht verändert
 * @param {unknown} file Inhalt von `positions.json`
 * @param {Record<string, number>} [counts] Mod-Plätze pro Pfad (`slotCounts`); ohne Angabe gilt `MAX_MOD_SLOTS`
 * @returns {{ items: Record<string, Entry>, problems: string[], sources: string[] }}
 */
export function applyPositions(items, file, counts = {}) {
  const record = file && typeof file === 'object' ? /** @type {Record<string, unknown>} */ (file) : undefined;
  if (!record || record['format'] !== POSITIONS_FORMAT || record['v'] !== 1 || !record['items'] || typeof record['items'] !== 'object') {
    throw new Error('positions.json: wrong format');
  }
  /** @type {Record<string, Entry>} */
  const out = { ...items };
  /** @type {string[]} */
  const problems = [];
  /** @type {Set<string>} */
  const sources = new Set();
  for (const [path, raw] of Object.entries(/** @type {Record<string, unknown>} */ (record['items']))) {
    const entry = raw && typeof raw === 'object' && !Array.isArray(raw) ? /** @type {Record<string, unknown>} */ (raw) : undefined;
    const current = out[path];
    const list = Array.isArray(entry?.['p']) ? entry['p'] : undefined;
    const source = typeof entry?.['source'] === 'string' ? entry['source'] : '';
    if (!entry || !list) problems.push(`${path}: bad entry (needs p, pm, source, date)`);
    else if ('wfcd' in entry) {
      // Ersatz (#213): eigene Liste statt der von WFCD, nur solange WFCD dieselbe Liste nennt wie beim Eintragen.
      const before = entry['wfcd'] === null ? undefined : polarityArray(entry['wfcd']);
      const p = polarityArray(list);
      if (!p || (entry['wfcd'] !== null && !before)) problems.push(`${path}: bad entry (needs p, pm, source, date)`);
      else if (JSON.stringify(before ?? null) !== JSON.stringify(current?.p ?? null)) problems.push(`${path}: WFCD list changed`);
      else if (!slotList(entry['pm'], counts[path] ?? MAX_MOD_SLOTS) || entry['pm'].length !== p.length) problems.push(`${path}: bad positions`);
      else if (!source || typeof entry['date'] !== 'string') problems.push(`${path}: source or date missing`);
      else if (checkExtras(path, entry, current, problems)) {
        // Gleiche Reihenfolge der Felder wie die übrigen Einträge: p zuerst, pm zuletzt; ohne Mod-Polaritäten beide weg.
        const { p: _wfcd, pm: _none, ...rest } = { ...current, ...extras(entry, current) };
        out[path] = p.length > 0 ? { p, ...rest, pm: entry['pm'] } : rest;
        sources.add(source);
      }
    } else if (!current?.p) problems.push(`${path}: no built-in mod polarities in WFCD`);
    else if (JSON.stringify(list) !== JSON.stringify(current.p)) problems.push(`${path}: WFCD list changed`);
    else if (!slotList(entry['pm'], counts[path] ?? MAX_MOD_SLOTS) || entry['pm'].length !== current.p.length) problems.push(`${path}: bad positions`);
    else if (!source || typeof entry['date'] !== 'string') problems.push(`${path}: source or date missing`);
    else if (checkExtras(path, entry, current, problems)) {
      out[path] = { ...current, pm: entry['pm'], ...extras(entry, current) };
      sources.add(source);
    }
  }
  return { items: out, problems, sources: [...sources].sort() };
}

/**
 * Prüft `a`, `x` und `s` eines Eintrags (#213): `a` nur als andere Reihenfolge derselben Aura-Polaritäten wie bei WFCD
 * (oder frei, wenn WFCD das Item nicht kennt); `x` und `s` nur, wenn WFCD das Item nicht kennt. Meldet Fehler.
 * @param {string} path @param {Record<string, unknown>} entry @param {Entry | undefined} current @param {string[]} problems
 */
function checkExtras(path, entry, current, problems) {
  /** @param {string} text */
  const fail = (text) => {
    problems.push(`${path}: ${text}`);
    return false;
  };
  if ('a' in entry) {
    const aura = asList(entry['a']);
    if (aura.length === 0 || !aura.every(isPolarity)) return fail('bad aura');
    if (current && !sameSet(aura, asList(current.a))) return fail('WFCD aura changed');
  }
  for (const key of ['x', 's']) {
    if (!(key in entry)) continue;
    if (current) return fail(`${key} only for items WFCD does not know`);
    if (!isPolarity(entry[key])) return fail(`bad ${key}`);
  }
  return true;
}

/** @param {Record<string, unknown>} entry @param {Entry | undefined} current @returns {Entry} */
function extras(entry, current) {
  /** @type {Entry} */
  const out = {};
  if ('a' in entry) {
    const aura = asList(entry['a']);
    out.a = aura.length === 1 ? /** @type {string} */ (aura[0]) : aura;
  }
  if (!current && typeof entry['x'] === 'string') out.x = entry['x'];
  if (!current && typeof entry['s'] === 'string') out.s = entry['s'];
  return out;
}
