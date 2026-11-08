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
 * @typedef {{ p: string[], pm: number[], source: string, date: string, note?: string }} PositionEntry
 *   Plätze ab Werk eines Items: `p` die Liste, zu der die Plätze gehören (wie beim Eintragen), `pm` der Platz jeder
 *   Polarität aus `p` (0 = unten rechts im Raster des Spiels), dazu Quelle und Datum.
 */

/** @param {unknown} value @param {number} limit @returns {value is number[]} */
function slotList(value, limit) {
  return Array.isArray(value) && value.every((slot) => Number.isInteger(slot) && slot >= 0 && slot < limit) && new Set(value).size === value.length;
}

/**
 * Plätze ab Werk aus `positions.json` in die Tabelle (#194). `pm` nur, wenn der Eintrag zur heutigen Liste von WFCD passt
 * (gleiche Polaritäten in gleicher Reihenfolge) und jede Polarität genau einen eigenen Platz hat. Sonst fällt er weg; die
 * Meldung nennt den Pfad (z. B. nach einem Rework, wenn WFCD die Liste ändert).
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
    else if (!current?.p) problems.push(`${path}: no built-in mod polarities in WFCD`);
    else if (JSON.stringify(list) !== JSON.stringify(current.p)) problems.push(`${path}: WFCD list changed`);
    else if (!slotList(entry['pm'], counts[path] ?? MAX_MOD_SLOTS) || entry['pm'].length !== current.p.length) problems.push(`${path}: bad positions`);
    else if (!source || typeof entry['date'] !== 'string') problems.push(`${path}: source or date missing`);
    else {
      out[path] = { ...current, pm: entry['pm'] };
      sources.add(source);
    }
  }
  return { items: out, problems, sources: [...sources].sort() };
}
