// @ts-check
// DEs Wochenwerte der Riven-Trades (#172, Host freigegeben am 08.11.2026 nur für diese Action): eine Zeile pro Riven-Typ,
// Waffe und gerollt/ungerollt mit Median und Beliebtheit (`pop`, die meistgehandelte Waffe = 100). Laut DE (2019) aus
// echten Trades gegen Platin im Spiel, ohne Trades für 1 Platin; jede Woche neu. Die Datei ist kein JSON, sondern ein
// JavaScript-Objekt (Schlüssel ohne Anführungszeichen, Texte in einfachen; gesehen am 08.11.2026). Der Leser wandelt sie
// um und verzeiht dazu ein BOM, Kommas vor `]`/`}`, Kommentare und `NaN`.

export const WEEKLY_URL = 'https://www-static.warframe.com/repos/weeklyRivensPC.json';
/** Plausibel ab so vielen Zeilen mit Waffe (Woche 45/2026: 804). */
export const MIN_WEEKLY_ROWS = 200;

/**
 * @typedef {{ median: number, pop: number }} WeeklyValue
 * @typedef {{ itemType: string, rolled?: WeeklyValue, unrolled?: WeeklyValue }} WeeklyWeapon
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const IDENTIFIER = /[A-Za-z_$][\w$]*/y;
const SPACE = /\s*/y;

/**
 * JavaScript-Objekt-Text → JSON-Text: Schlüssel ohne Anführungszeichen und Texte in einfachen Anführungszeichen werden zu
 * JSON, `NaN`/`Infinity` zu `null`, Kommas vor `]`/`}` und Kommentare fallen weg. Wirft bei allem anderen.
 * @param {string} text
 */
export function looseJson(text) {
  let out = '';
  let i = 0;
  const skipSpace = (/** @type {number} */ from) => {
    SPACE.lastIndex = from;
    SPACE.exec(text);
    return SPACE.lastIndex;
  };
  while (i < text.length) {
    const char = text[i] ?? '';
    if (char === '"' || char === "'") {
      let value = '';
      let j = i + 1;
      for (; j < text.length && text[j] !== char; j++) {
        const current = text[j] ?? '';
        if (current === '\\') {
          const next = text[j + 1] ?? '';
          value += next === "'" ? "'" : `\\${next}`;
          j++;
        } else value += current === '"' ? '\\"' : current;
      }
      if (j >= text.length) throw new Error('weekly rivens: open string');
      out += `"${value}"`;
      i = j + 1;
    } else if (char === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
    } else if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (char === ',') {
      const next = text[skipSpace(i + 1)];
      if (next !== ']' && next !== '}') out += ',';
      i++;
    } else if (/[A-Za-z_$]/.test(char)) {
      IDENTIFIER.lastIndex = i;
      const word = IDENTIFIER.exec(text)?.[0] ?? char;
      i += word.length;
      if (text[skipSpace(i)] === ':') out += JSON.stringify(word);
      else if (word === 'true' || word === 'false' || word === 'null') out += word;
      else if (word === 'NaN' || word === 'Infinity') out = `${out.replace(/-$/, '')}null`;
      else throw new Error(`weekly rivens: unexpected ${word}`);
    } else {
      out += char;
      i++;
    }
  }
  return out;
}

/** Text → Liste; wirft, wenn es auch nach dem Umwandeln kein Array ist. @param {string} text @returns {unknown[]} */
export function parseWeeklyText(text) {
  const clean = text.replace(/^﻿/, '');
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(clean);
  } catch {
    json = JSON.parse(looseJson(clean));
  }
  if (!Array.isArray(json)) throw new Error('weekly rivens: not a list');
  return json;
}

/**
 * Pro Waffe (englischer Name, klein geschrieben) Median und `pop` gerollter und ungerollter Rivens. Zeilen ohne Waffe
 * (verhüllte Typen) und kaputte Zeilen fallen weg. Wirft unter `MIN_WEEKLY_ROWS` Zeilen.
 * @param {string} text @returns {Map<string, WeeklyWeapon>}
 */
export function readWeekly(text) {
  /** @type {Map<string, WeeklyWeapon>} */
  const weapons = new Map();
  let rows = 0;
  for (const row of parseWeeklyText(text)) {
    if (!isRecord(row) || typeof row['compatibility'] !== 'string' || typeof row['itemType'] !== 'string') continue;
    const { median, pop } = row;
    if (typeof median !== 'number' || !(median > 0) || typeof pop !== 'number' || !Number.isFinite(pop)) continue;
    rows++;
    const name = row['compatibility'].trim().toLowerCase();
    const weapon = weapons.get(name) ?? { itemType: row['itemType'] };
    weapon[row['rerolled'] === true ? 'rolled' : 'unrolled'] = { median, pop };
    weapons.set(name, weapon);
  }
  if (rows < MIN_WEEKLY_ROWS) throw new Error(`weekly rivens: only ${rows} rows`);
  return weapons;
}

/** Median für die Datei: ab 10 ganz, darunter eine Stelle. @param {number} value */
const roundMedian = (value) => (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10);

/**
 * Wert in der Datei: `[Median gerollt, pop gerollt, Median ungerollt, pop ungerollt]`, fehlende als `null`.
 * @param {WeeklyWeapon | undefined} weapon @returns {(number | null)[] | undefined}
 */
export function weeklyEntry(weapon) {
  if (!weapon || (!weapon.rolled && !weapon.unrolled)) return undefined;
  const { rolled, unrolled } = weapon;
  return [rolled ? roundMedian(rolled.median) : null, rolled ? rolled.pop : null, unrolled ? roundMedian(unrolled.median) : null, unrolled ? unrolled.pop : null];
}
