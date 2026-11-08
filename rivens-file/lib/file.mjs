// @ts-check
// Datei `rivens/v1/prices.json` (#172) und der Merkzettel der Action `rivens/state.json`. Format im README
// („Riven prices“). Die App liest nur `prices.json`; `state.json` hält, was der nächste Lauf braucht (Waffenliste für Läufe
// ohne warframe.market, volle Paare, Grundwerte für das Würfelglück).

import { isBaseValues } from './rolls.mjs';
import { LUCK_WINDOW, MAX_AGE_DAYS, MIN_RANGE, MIN_UNSURE, RANGE, SINCE } from './stats.mjs';

export const FORMAT = 'tennodock-rivens';
export const VERSION = 1;
export const FILE = 'v1/prices.json';
export const STATE_FILE = 'state.json';
export const SOURCE = 'warframe.market, Digital Extremes';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @typedef {import('./stats.mjs').Entry} Entry
 * @typedef {import('./rolls.mjs').BaseValues} BaseValues
 * @typedef {{ at?: string, de?: (number | null)[], pairs?: string[], c?: Record<string, Entry> }} WeaponRecord
 *   `at`: Tag der Suchen; `de`: DEs Wochenwert; `pairs`: gesuchte Paare als Indizes (`0.1`, `!` = unvollständig).
 * @typedef {{ format: string, v: number, asOf: string, generatedAt: string, source: string, since: string, maxAgeDays: number,
 *   range: readonly number[], minRange: number, minUnsure: number, luckWindow: number, deAt?: string, stats: string[],
 *   weapons: Record<string, WeaponRecord> }} RivensFile
 * @typedef {{ slug: string, path: string, name: string, group?: string, rivenType?: string }} StateWeapon
 * @typedef {{ v: number, weapons?: StateWeapon[], big?: Record<string, string[]>, exportIndex?: string, base?: BaseValues }} State
 *   `big`: Waffenpfad → Paare (`Tag+Tag`), die zuletzt 100 Treffer hatten.
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Datei in fester Form; Waffen nach Pfad sortiert, damit der Commit nur echte Änderungen zeigt.
 * @param {{ asOf: string, now: number, deAt?: string, stats: string[], weapons: Record<string, WeaponRecord> }} input
 * @returns {RivensFile}
 */
export function buildFile({ asOf, now, deAt, stats, weapons }) {
  /** @type {Record<string, WeaponRecord>} */
  const sorted = {};
  for (const path of Object.keys(weapons).sort()) {
    const record = weapons[path];
    if (record && (record.de || record.at)) sorted[path] = record;
  }
  return {
    format: FORMAT,
    v: VERSION,
    asOf,
    generatedAt: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: SOURCE,
    since: SINCE,
    maxAgeDays: MAX_AGE_DAYS,
    range: [...RANGE],
    minRange: MIN_RANGE,
    minUnsure: MIN_UNSURE,
    luckWindow: LUCK_WINDOW,
    ...(deAt ? { deAt } : {}),
    stats,
    weapons: sorted,
  };
}

/** Kompakt, eine Waffe pro Zeile (lesbare Diffs, gzip macht den Rest). @param {RivensFile} file */
export function encodeFile(file) {
  const { weapons, ...head } = file;
  const lines = Object.entries(weapons).map(([path, record]) => `  ${JSON.stringify(path)}: ${JSON.stringify(record)}`);
  const headText = JSON.stringify(head).slice(0, -1);
  return `${headText},\n"weapons": {\n${lines.join(',\n')}\n}}\n`;
}

/**
 * Prüft eine Datei vor dem Schreiben: Format, Tage, jeder Index in `stats`, Einträge mit tief ≤ hoch und Anzahl ab 5.
 * @param {RivensFile} file @returns {string[]} Fehler; leer = gültig
 */
export function checkFile(file) {
  /** @type {string[]} */
  const errors = [];
  if (file.format !== FORMAT || file.v !== VERSION) errors.push('format');
  if (!DAY.test(file.asOf)) errors.push('asOf');
  const statCount = file.stats.length;
  const indexOk = (/** @type {string} */ key) => key.replace(/^\*/, '').replace(/[|!].*$/, '').split('.').every((part) => /^\d+$/.test(part) && Number(part) < statCount);
  for (const [path, record] of Object.entries(file.weapons)) {
    if (path.startsWith('/')) errors.push(`${path}: path`);
    if (record.at !== undefined && !DAY.test(record.at)) errors.push(`${path}: at`);
    for (const pair of record.pairs ?? []) if (!indexOk(pair) || pair.replace('!', '').split('.').length !== 2) errors.push(`${path}: pair ${pair}`);
    for (const [key, entry] of Object.entries(record.c ?? {})) {
      if (!/^\*?\d+(\.\d+){1,2}\|[nhs]$/.test(key) || !indexOk(key)) errors.push(`${path}: key ${key}`);
      if (!(entry[0] > 0 && entry[0] <= entry[1] && entry[2] >= MIN_UNSURE)) errors.push(`${path}: entry ${key}`);
    }
  }
  return errors;
}

/** Gespeicherte Datei lesen; kaputt oder fremd: `undefined`. @param {string | undefined} text @returns {RivensFile | undefined} */
export function readFile(text) {
  if (!text) return undefined;
  try {
    const json = JSON.parse(text);
    if (!isRecord(json) || json['format'] !== FORMAT || json['v'] !== VERSION || !Array.isArray(json['stats']) || !isRecord(json['weapons'])) return undefined;
    return /** @type {RivensFile} */ (/** @type {unknown} */ (json));
  } catch {
    return undefined;
  }
}

/** Merkzettel lesen; kaputte Teile fallen weg. @param {string | undefined} text @returns {State} */
export function readState(text) {
  try {
    const json = text ? JSON.parse(text) : undefined;
    if (!isRecord(json)) return { v: 1 };
    /** @type {State} */
    const state = { v: 1 };
    if (Array.isArray(json['weapons'])) state.weapons = json['weapons'].filter((weapon) => isRecord(weapon) && typeof weapon['slug'] === 'string' && typeof weapon['path'] === 'string' && typeof weapon['name'] === 'string');
    if (isRecord(json['big'])) {
      /** @type {Record<string, string[]>} */
      const big = {};
      for (const [path, pairs] of Object.entries(json['big'])) if (Array.isArray(pairs) && pairs.every((pair) => typeof pair === 'string')) big[path] = pairs;
      state.big = big;
    }
    if (typeof json['exportIndex'] === 'string') state.exportIndex = json['exportIndex'];
    if (isBaseValues(json['base'])) state.base = json['base'];
    return state;
  } catch {
    return { v: 1 };
  }
}

/** @param {State} state */
export const encodeState = (state) => `${JSON.stringify(state)}\n`;

/** Inhalt ohne `generatedAt`, um „nichts geändert“ zu erkennen. @param {RivensFile} file */
export const contentOf = (file) => JSON.stringify({ ...file, generatedAt: '' });
