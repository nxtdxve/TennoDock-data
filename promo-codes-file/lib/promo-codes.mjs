// @ts-check
// Promo-Codes (#135) aus dem Quelltext der Wiki-Seite „Promo Codes“: Tabelle unter „Active Codes“ (Spalten Code, Type,
// Context, Dates Active, Reward(s)); die Tabelle unter „Inactive Codes“ dient nur der Prüfung, dass die Seite ganz ist.
// Reine Funktionen ohne Abhängigkeiten. Die App liest nur die fertige Datei.

import { CODE, wikiSection } from '../../glyph-codes-file/lib/glyph-codes.mjs';

/**
 * @typedef {'placeholder' | 'description' | 'unreadable'} NoCode Warum eine Zeile keinen Code hat: `placeholder` (leer oder
 *   „TBA“ u. Ä.), `description` (lesbarer Text mit Leerzeichen oder Klammern, z. B. „DUVIRI-(Warframe name)“, ein Muster
 *   statt eines Codes), `unreadable` (Inhalt nicht lesbar, z. B. nur eine Vorlage, oder ein kaputter Code).
 * @typedef {{ codes: string[], noCode?: NoCode, context?: string, from?: string, until?: string, rewards: string[], unreadRewards?: true }} PromoRow
 *   Eine Zeile der Tabelle: Codes (meist einer), Anlass, Beginn und Ende (`JJJJ-MM-TT`, nur aus eindeutigen Bereichen)
 *   und die Belohnungen als Text. `noCode` nur, wenn kein Code erkannt wurde.
 * @typedef {{ header: string[], rows: string[][] }} WikiTable
 */

export const ACTIVE = 'Active Codes';
export const INACTIVE = 'Inactive Codes';
/** Wörter, die in der Code-Zelle für „noch kein Code“ stehen; sie sind nie ein Code. */
export const PLACEHOLDER = /^(?:none|tba|tbd|tbc|n\/?a|unknown|soon|coming soon|\?+|-+|–|—)$/i;
/** Höchstlänge von Anlass und Belohnung (Zeichen); längere Texte werden gekürzt. */
export const MAX_TEXT = 120;
/** Höchstens so viele Belohnungen pro Zeile. */
export const MAX_REWARDS = 20;

/** Text auf `MAX_TEXT` Zeichen kürzen. @param {string} text */
export const shorten = (text) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1).trimEnd()}…` : text);

/**
 * Teilt an `separator`, nur ausserhalb von `[[…]]` und `{{…}}`.
 * @param {string} text @param {string} separator @returns {string[]}
 */
function splitOutside(text, separator) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let current = '';
  for (let at = 0; at < text.length; at++) {
    const pair = text.slice(at, at + 2);
    if (pair === '[[' || pair === '{{') {
      depth++;
      current += pair;
      at++;
    } else if ((pair === ']]' || pair === '}}') && depth > 0) {
      depth--;
      current += pair;
      at++;
    } else if (depth === 0 && text.startsWith(separator, at)) {
      parts.push(current);
      current = '';
      at += separator.length - 1;
    } else {
      current += text[at];
    }
  }
  return [...parts, current];
}

/** Attribute vor einem einzelnen `|` fallen weg (`style="…"|Inhalt`). @param {string} cell */
function cellContent(cell) {
  const parts = splitOutside(cell, '|');
  return parts.length > 1 && /=/.test(parts[0] ?? '') ? parts.slice(1).join('|') : cell;
}

/**
 * Erste Tabelle `{| … |}` im Text: Kopf (`!`) und Zeilen mit Zellen (`|`, `||`); Zeilen ohne Zeichen am Anfang gehören
 * zur letzten Zelle. `undefined` ohne Tabelle.
 * @param {string} text @returns {WikiTable | undefined}
 */
export function parseTable(text) {
  const start = text.indexOf('{|');
  if (start < 0) return undefined;
  const end = text.indexOf('\n|}', start);
  /** @type {string[]} */
  const header = [];
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[] | undefined} */
  let row;
  for (const raw of text
    .slice(start, end < 0 ? undefined : end)
    .split('\n')
    .slice(1)) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('|-')) row = undefined;
    else if (line.startsWith('!')) header.push(...splitOutside(line.slice(1), '!!').map((cell) => clean(cellContent(cell))));
    else if (line.startsWith('|')) {
      if (!row) rows.push((row = []));
      row.push(...splitOutside(line.slice(1), '||').map(cellContent));
    } else if (row && row.length > 0) row[row.length - 1] += `\n${line}`;
  }
  return { header, rows };
}

/**
 * Wiki-Text als Klartext: ohne Einzelnachweise, Kommentare und Formatierung; Links und Vorlagen wie `{{Weapon|Zylok}}`
 * werden zu ihrem Text, `<br>` zu einer neuen Zeile.
 * @param {string} text @returns {string}
 */
export function clean(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/\{\{(?:Weapon|Resource|WF|Warframe|Item|Mod|Arcane|Companion|M|A|R)\|([^|{}]*)(?:\|([^{}]*))?\}\}/gi, (_, name, shown) => shown ?? name)
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Codes einer Zelle: der Text der Links und `?code=` in ihren Adressen, getrennt an Zeilen und Kommas; jeder einmal (ohne
 * Gross- und Kleinschreibung). Was kein Code sein kann (Leerzeichen, Klammern, Platzhalter wie „TBA“), fällt weg.
 * @param {string} cell @returns {string[]}
 */
export function codesIn(cell) {
  const found = [...cell.matchAll(/[?&]code=([^\s\]&|]+)/g)].map((match) => safeDecode(match[1] ?? ''));
  found.push(
    ...clean(cell)
      .split(/\n|,|\s\/\s|\sor\s/)
      .map((part) => part.trim()),
  );
  const seen = new Set();
  return found.filter((code) => CODE.test(code) && !PLACEHOLDER.test(code) && !seen.has(code.toLowerCase()) && seen.add(code.toLowerCase()));
}

/** Die Zelle hat Inhalt (ohne Kommentare und Leerraum), lesbar oder nicht. @param {string} cell */
export const hasContent = (cell) => cell.replace(/<!--[\s\S]*?-->/g, '').trim() !== '';

/**
 * Die Code-Zelle ist leer oder nennt nur Platzhalter. Eine Zelle, deren Inhalt sich nicht lesen lässt (z. B. nur eine
 * Vorlage wie `{{PromoCode|X}}`), ist kein Platzhalter.
 * @param {string} cell
 */
export function isPlaceholderCell(cell) {
  if (!hasContent(cell)) return true;
  const parts = clean(cell).split('\n').filter(Boolean);
  return parts.length > 0 && parts.every((part) => PLACEHOLDER.test(part));
}

/**
 * Warum eine Code-Zelle ohne erkannten Code keinen hat (`NoCode`). Lesbarer Text mit Leerzeichen oder Klammern ist eine
 * Beschreibung (2023 stand z. B. „DUVIRI-(Warframe name)“ über zwei Monate unter „Active Codes“); alles andere ist nicht
 * lesbar.
 * @param {string} cell @returns {NoCode}
 */
export function noCodeReason(cell) {
  if (isPlaceholderCell(cell)) return 'placeholder';
  const text = clean(cell);
  return text && /[\s()]/.test(text) ? 'description' : 'unreadable';
}

/** @param {string} text */
function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Tag als `JJJJ-MM-TT` aus `2026-11-02` oder `November 2, 2026`; sonst `undefined`. @param {string} text */
export function isoDay(text) {
  const value = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const written = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(value);
  const month = written ? MONTHS.indexOf((written[1] ?? '').toLowerCase()) : -1;
  const day = iso ? value : written && month >= 0 ? `${written[3]}-${String(month + 1).padStart(2, '0')}-${(written[2] ?? '').padStart(2, '0')}` : undefined;
  return day && !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day) ? day : undefined;
}

/**
 * Beginn und Ende aus „A to B“ oder „A - B“ (B auch „Indefinite“ oder „?“) und „Expired B“. Ein einzelnes Datum ist im
 * Wiki mal Beginn, mal Ende und zählt deshalb nicht.
 * @param {string} cell @returns {{ from?: string, until?: string }}
 */
export function parseDates(cell) {
  const text = clean(cell).replace(/\n/g, ' ');
  const expired = /^expired\s+(.+)$/i.exec(text);
  const range = /^(.+?)\s+(?:to|-|–|until)\s+(.+)$/i.exec(text);
  const from = range ? isoDay(range[1] ?? '') : undefined;
  const until = expired ? isoDay(expired[1] ?? '') : range ? isoDay(range[2] ?? '') : undefined;
  // Ein Ende vor dem Beginn ist ein Tippfehler im Wiki; dann ist keines der beiden eindeutig.
  if (from && until && until < from) return {};
  return { ...(from && { from }), ...(until && { until }) };
}

/**
 * Belohnungen einzeln: getrennt an Zeilen, „, “ (nicht in Zahlen wie „220,000“), „ and “ und „;“; ohne „Adds“ vorne.
 * @param {string} cell @returns {string[]}
 */
export function rewardParts(cell) {
  return clean(cell)
    .split(/\n|,\s+(?!\d{3}\b)|\s+and\s+|;\s*/)
    .map((part) =>
      part
        .replace(/^(?:adds|and)\s+/i, '')
        .replace(/[.\s]+$/, '')
        .trim(),
    )
    .filter((part) => part.length > 1)
    .slice(0, MAX_REWARDS)
    .map(shorten);
}

/** Spalte über den Namen im Kopf, nicht über die Stelle. @param {string[]} header @param {RegExp} name */
const column = (header, name) => header.findIndex((cell) => name.test(cell));

/**
 * Zeilen einer Tabelle der Seite. Wirft, wenn die Spalten „Code“ und „Reward(s)“ fehlen (Form der Seite geändert).
 * @param {WikiTable} table @returns {PromoRow[]}
 */
export function promoRows(table) {
  const at = {
    code: column(table.header, /^code/i),
    context: column(table.header, /^context/i),
    dates: column(table.header, /^dates?\b/i),
    rewards: column(table.header, /^rewards?\b/i),
  };
  if (at.code < 0 || at.rewards < 0) throw new Error(`Unexpected columns: ${table.header.join(' | ')}`);
  return table.rows.map((cells) => {
    const cell = (/** @type {number} */ index) => (index >= 0 ? (cells[index] ?? '') : '');
    const context = shorten(clean(cell(at.context)).replace(/\n/g, ' '));
    const codes = codesIn(cell(at.code));
    const rewards = rewardParts(cell(at.rewards));
    return {
      codes,
      ...(codes.length === 0 && { noCode: noCodeReason(cell(at.code)) }),
      ...(context && { context }),
      ...parseDates(cell(at.dates)),
      rewards,
      // Belohnung steht da, lässt sich aber nicht lesen (z. B. nur in einer unbekannten Vorlage).
      ...(rewards.length === 0 && hasContent(cell(at.rewards)) && { unreadRewards: /** @type {const} */ (true) }),
    };
  });
}

/**
 * Aktive und inaktive Zeilen der Seite. Wirft, wenn ein Abschnitt oder seine Tabelle fehlt.
 * @param {string} source @returns {{ active: PromoRow[], inactive: PromoRow[] }}
 */
export function parsePromoPage(source) {
  /** @param {string} heading */
  const rows = (heading) => {
    const section = wikiSection(source, heading);
    if (section === undefined) throw new Error(`No section "${heading}" on the page`);
    const table = parseTable(section);
    if (!table) throw new Error(`No table under "${heading}"`);
    return promoRows(table);
  };
  return { active: rows(ACTIVE), inactive: rows(INACTIVE) };
}
