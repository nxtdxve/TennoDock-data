// @ts-check
// Prüfung der von Hand gepflegten Datei `palettes/v1/palettes.json` (#206): ob es jede Farbpalette noch gibt. Reine
// Funktionen ohne Abhängigkeiten. Die App liest nur `a` und `k`; `src`, `checked` und `n` sind für die Pflege.
// Später kann die Action `sources.yml` die Datei aus dem Wiki bauen (erst mit schriftlicher Zustimmung von Weird Gloop).

/** Status: jederzeit, kommt wieder bzw. befristet, nicht mehr erhältlich, nur Konsole, nie für Spieler, unklar. */
export const STATUSES = ['buy', 'limited', 'gone', 'console', 'never', 'unknown'];
/** Art des Fundorts bzw. Grund; die App macht daraus ihre Texte. */
export const KINDS = ['market', 'bundle', 'varzia', 'event', 'seasonal', 'baro', 'nightwave', 'anniversary', 'promo', 'twitch', 'supporterPack', 'none'];
/** Woher die Angabe stammt: Wiki-Seite (`page`), DE-Export bzw. public-export-plus, worldState. */
export const SOURCES = ['wiki', 'export', 'worldstate'];
export const PALETTE_ROOT = '/Lotus/Types/StoreItems/SuitCustomizations/';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Untergrenze: Das Spiel hat rund 70 Paletten; weniger heisst, es ist etwas verloren gegangen. */
export const MINIMUM = 60;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Fehler der Datei als Liste von Sätzen; leer, wenn alles stimmt.
 * @param {unknown} file @returns {string[]}
 */
export function checkPalettes(file) {
  if (!isRecord(file)) return ['the file is not a JSON object'];
  const errors = [];
  if (file['format'] !== 'tennodock-palettes') errors.push('format must be "tennodock-palettes"');
  if (file['v'] !== 1) errors.push('v must be 1');
  if (typeof file['asOf'] !== 'string' || !DAY.test(file['asOf'])) errors.push('asOf must be a day (YYYY-MM-DD)');
  for (const key of ['source', 'page', 'license']) if (typeof file[key] !== 'string' || file[key] === '') errors.push(`${key} is missing`);
  const palettes = file['palettes'];
  if (!isRecord(palettes)) return [...errors, 'palettes must be an object'];
  const paths = Object.keys(palettes);
  if (paths.length < MINIMUM) errors.push(`only ${paths.length} palettes, expected at least ${MINIMUM}`);
  for (const path of paths) {
    const entry = palettes[path];
    if (!path.startsWith(PALETTE_ROOT)) errors.push(`${path}: not a palette path`);
    if (!isRecord(entry)) {
      errors.push(`${path}: entry must be an object`);
      continue;
    }
    if (!STATUSES.includes(/** @type {string} */ (entry['a']))) errors.push(`${path}: a must be one of ${STATUSES.join(', ')}`);
    if (!KINDS.includes(/** @type {string} */ (entry['k']))) errors.push(`${path}: k must be one of ${KINDS.join(', ')}`);
    const src = entry['src'];
    if (!Array.isArray(src) || src.length === 0 || !src.every((item) => SOURCES.includes(item))) errors.push(`${path}: src must list ${SOURCES.join(', ')}`);
    if (typeof entry['checked'] !== 'string' || !DAY.test(entry['checked'])) errors.push(`${path}: checked must be a day (YYYY-MM-DD)`);
    else if (typeof file['asOf'] === 'string' && entry['checked'] > file['asOf']) errors.push(`${path}: checked is after asOf`);
    if (entry['n'] !== undefined && (typeof entry['n'] !== 'string' || entry['n'].length > 160)) errors.push(`${path}: n must be a short text`);
  }
  return errors;
}
