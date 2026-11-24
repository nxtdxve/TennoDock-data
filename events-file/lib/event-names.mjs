// @ts-check
// Namen der Events für TennoDock (#188): reine Funktionen ohne Netz. Die Quelle sind die Sprachdateien von WFCD
// `warframe-worldstate-data` (MIT): `data/languages.json` (Englisch) und `data/de/languages.json` (Deutsch), Schlüssel wie
// `Goals[].Desc` im worldState (teils klein geschrieben), Wert `{ value }`. Die App zeigt den Namen eines laufenden Events
// darüber; ohne Namen nennt sie die Währung des Events.

/** Höchstens so lang darf ein Name sein; längere Texte sind Beschreibungen, keine Namen. */
export const MAX_NAME = 80;

/**
 * Schlüssel, die Namen von Events sind (Abgleich 23.11.2026, 13 Treffer): `…EventName`, `…EventTitle`, Kopfgeld-Events
 * (`…BountyName`) und Feste wie Naberus und Star Days. Neue Events mit anderer Form kommen über den worldState dazu.
 */
const EVENT_KEY = /(event(name|title)|bountyname|naberusname|valentinesfortunaname)$/i;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** @param {string} key */
export const isEventKey = (key) => key.toLowerCase().startsWith('/lotus/language/') && EVENT_KEY.test(key);

/**
 * Text eines Eintrags: `{ value }` oder ein Text; ohne Steuerzeichen, getrimmt, höchstens `MAX_NAME` Zeichen. Sonst
 * `undefined`.
 * @param {unknown} entry @returns {string | undefined}
 */
export function nameOf(entry) {
  const raw = typeof entry === 'string' ? entry : isRecord(entry) && typeof entry['value'] === 'string' ? entry['value'] : undefined;
  // Steuerzeichen werden Leerzeichen (ohne Regex mit Steuerzeichen).
  const plain = raw === undefined ? undefined : [...raw].map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char)).join('');
  const text = plain?.replace(/\s+/g, ' ').trim();
  return text && text.length <= MAX_NAME ? text : undefined;
}

/**
 * Sprachdatei nach klein geschriebenem Schlüssel; Einträge ohne brauchbaren Namen fallen weg.
 * @param {unknown} json @returns {Map<string, string>}
 */
export function readLanguages(json) {
  const names = new Map();
  if (!isRecord(json)) return names;
  for (const [key, entry] of Object.entries(json)) {
    const name = nameOf(entry);
    if (name && key.startsWith('/') && !names.has(key.toLowerCase())) names.set(key.toLowerCase(), name);
  }
  return names;
}

/**
 * Sprachschlüssel der laufenden Events im worldState (`Goals[].Desc`), klein geschrieben.
 * @param {unknown} worldState @returns {string[]}
 */
export function runningKeys(worldState) {
  const goals = isRecord(worldState) && Array.isArray(worldState['Goals']) ? worldState['Goals'] : [];
  return goals.flatMap((goal) => (isRecord(goal) && typeof goal['Desc'] === 'string' && goal['Desc'].startsWith('/') ? [goal['Desc'].toLowerCase()] : []));
}

/**
 * @typedef {{ en: string, de?: string }} EventName
 * @typedef {Record<string, EventName>} NameTable Schlüssel klein geschrieben.
 */

/**
 * Tabelle der Namen: alles Bisherige, dazu jeder Event-Schlüssel aus WFCD und jedes laufende Event, das WFCD kennt. Ein
 * Name, den WFCD nicht mehr führt, bleibt; einen geänderten übernimmt die Tabelle. Deutsch nur, wenn es anders lautet.
 * @param {{ en: Map<string, string>, de: Map<string, string>, previous?: NameTable, running?: string[] }} input
 * @returns {NameTable}
 */
export function buildNames({ en, de, previous = {}, running = [] }) {
  const keys = new Set([...Object.keys(previous), ...[...en.keys()].filter(isEventKey), ...running.filter((key) => en.has(key))]);
  /** @type {NameTable} */
  const names = {};
  for (const key of [...keys].sort()) {
    const english = en.get(key) ?? previous[key]?.en;
    if (!english) continue;
    // Deutsch nur, wenn es anders lautet: Viele Event-Namen bleiben auch im deutschen Spiel englisch.
    const german = de.get(key) ?? previous[key]?.de;
    names[key] = german && german !== english ? { en: english, de: german } : { en: english };
  }
  return names;
}

/**
 * Bisherige Tabelle aus der Datei, nur gültige Einträge.
 * @param {unknown} file @returns {NameTable}
 */
export function previousNames(file) {
  /** @type {NameTable} */
  const names = {};
  const table = isRecord(file) && isRecord(file['names']) ? file['names'] : {};
  for (const [key, entry] of Object.entries(table)) {
    const en = isRecord(entry) ? nameOf(entry['en']) : undefined;
    const de = isRecord(entry) ? nameOf(entry['de']) : undefined;
    if (en && key.startsWith('/')) names[key.toLowerCase()] = de ? { en, de } : { en };
  }
  return names;
}
