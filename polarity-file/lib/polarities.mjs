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
 * @typedef {{ p?: string[], a?: string | string[], x?: string, s?: string }} Entry
 *   `p` eingebaute Polaritäten der Mod-Plätze (Reihenfolge wie im Wiki, ohne Platz), `a` Aura (Jade: zwei Plätze),
 *   `x` Exilus, `s` Haltung.
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
