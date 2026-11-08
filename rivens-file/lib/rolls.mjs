// @ts-check
// Würfelglück fremder Riven-Angebote (#172), wie die App es für #55 rechnet (`src/core/masterdata/rivens.ts` und
// `src/modules/rivens/domain/value.ts`): Grundwerte pro Riven-Typ aus DEs `ExportUpgrades`, die Formel des Spiels
//   Wert = Grundwert × 10 × (Rang + 1) × Disposition 1,2 × Formfaktor × (0,9 + 0,2 × Würfel)
// und daraus zurück der Würfel einer angezeigten Zahl. Seit Hotfix 44.1.3 (22.10.2026) gilt für alle Waffen Disposition 1,2.

import { RIVEN_TYPES, WEAPON_CLASSES } from './rules.mjs';

/** @typedef {import('./rules.mjs').WeaponClass} WeaponClass */
/**
 * Grundwert, Einheit (`p` Prozent, `s` Sekunden, `m` Faktor, `n` Zahl) und umgekehrtes Vorzeichen (1) einer Eigenschaft.
 * @typedef {[number, 'p' | 's' | 'm' | 'n'] | [number, 'p' | 's' | 'm' | 'n', 1]} BaseValue
 * @typedef {Partial<Record<WeaponClass, Record<string, BaseValue>>>} BaseValues Pro Waffenart: Tag → Grundwert.
 */

export const DISPOSITION = 1.2;
const MAX_RANK = 8;
const PLACEHOLDER = /\|[A-Za-z0-9]+\|(%|s(?=\s))?/;
const FACTION_TAG = /FactionDamage/;
/** Reste der 32-Bit-Rechnung des Spiels, als Anteil einer Stelle zusätzlich zur halben Stelle der Rundung. */
const SHOWN_SLACK = 0.05;

/** Formfaktor je Zahl der Vorteile und Nachteile (Wiki „Riven Mods“). @type {Readonly<Record<string, { buff: number, curse?: number }>>} */
const SHAPE_FACTORS = {
  '2/0': { buff: 0.99 },
  '2/1': { buff: 1.2375, curse: -0.495 },
  '3/0': { buff: 0.75 },
  '3/1': { buff: 0.9375, curse: -0.75 },
};

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Grundwerte der sieben Riven-Typen aus `ExportUpgrades_en.json` (DE-Export, Feld `ExportUpgrades`). Nur der erste Wert
 * zählt (der zweite ist z. B. „x2 for Bows“); die Einheit steht als Platzhalter im Text (`|val|%`).
 * @param {unknown} json @returns {BaseValues}
 */
export function readBaseValues(json) {
  const list = isRecord(json) && Array.isArray(json['ExportUpgrades']) ? json['ExportUpgrades'] : [];
  /** @type {BaseValues} */
  const result = {};
  for (const weaponClass of WEAPON_CLASSES) {
    const entry = list.find((item) => isRecord(item) && item['uniqueName'] === RIVEN_TYPES[weaponClass]);
    const upgrades = isRecord(entry) && Array.isArray(entry['upgradeEntries']) ? entry['upgradeEntries'] : [];
    /** @type {Record<string, BaseValue>} */
    const stats = {};
    for (const item of upgrades) {
      if (!isRecord(item) || typeof item['tag'] !== 'string') continue;
      const first = Array.isArray(item['upgradeValues']) ? item['upgradeValues'][0] : undefined;
      if (!isRecord(first) || typeof first['value'] !== 'number' || !Number.isFinite(first['value'])) continue;
      const text = (typeof first['locTag'] === 'string' ? first['locTag'] : '').replace(/<[^>]*>/g, '');
      const mark = PLACEHOLDER.exec(text)?.[1];
      const unit = FACTION_TAG.test(item['tag']) ? 'm' : mark === '%' ? 'p' : mark === 's' ? 's' : 'n';
      stats[item['tag']] = first['reverseValueSymbol'] === true ? [first['value'], unit, 1] : [first['value'], unit];
    }
    if (Object.keys(stats).length > 0) result[weaponClass] = stats;
  }
  return result;
}

/** @param {unknown} value @returns {value is BaseValues} */
export function isBaseValues(value) {
  return isRecord(value) && Object.entries(value).every(([key, stats]) => WEAPON_CLASSES.includes(/** @type {WeaponClass} */ (key)) && isRecord(stats) && Object.values(stats).every((stat) => Array.isArray(stat) && typeof stat[0] === 'number' && ['p', 's', 'm', 'n'].includes(stat[1])));
}

/**
 * Wert einer Eigenschaft als Anteil; `undefined` bei unmöglicher Form oder Rang.
 * @param {number} base @param {{ rank: number, buffs: number, curses: number, curse: boolean }} context @param {number} roll
 */
export function statValue(base, context, roll) {
  const factors = SHAPE_FACTORS[`${context.buffs}/${context.curses}`];
  const factor = context.curse ? factors?.curse : factors?.buff;
  const { rank } = context;
  if (factor === undefined || !Number.isInteger(rank) || rank < 0 || rank > MAX_RANK) return undefined;
  return base * 10 * (rank + 1) * DISPOSITION * factor * (0.9 + 0.2 * roll);
}

/** Anzeige wie im Spiel: Prozent als 180.6, Faktor als 1.25. @param {BaseValue} stat @param {number} value */
export function displayValue(stat, value) {
  if (stat[1] === 'm') return 1 + value;
  const signed = stat[2] === 1 ? -value : value;
  return stat[1] === 'p' ? signed * 100 : signed;
}

/**
 * Würfel aus der Anzeige (`rivenRollFromShown` der App): die Anzeige ist auf eine Stelle gerundet (Faktor 0,01, sonst
 * 0,1). Liegt der Bereich ganz ausserhalb 0 bis 1, passt die Zahl nicht: `undefined`.
 * @param {BaseValue} stat @param {{ rank: number, buffs: number, curses: number, curse: boolean }} context @param {number} shown
 * @returns {{ min: number, max: number } | undefined}
 */
export function rollFromShown(stat, context, shown) {
  const low = statValue(stat[0], context, 0);
  const high = statValue(stat[0], context, 1);
  if (low === undefined || high === undefined || !Number.isFinite(shown)) return undefined;
  const from = displayValue(stat, low);
  const span = displayValue(stat, high) - from;
  if (span === 0) return undefined;
  const half = (stat[1] === 'm' ? 0.01 : 0.1) * (0.5 + SHOWN_SLACK);
  const a = (shown - half - from) / span;
  const b = (shown + half - from) / span;
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  if (max < 0 || min > 1) return undefined;
  return { min: Math.max(0, min), max: Math.min(1, max) };
}

/** Bis Rang 6 überlappt der Bereich nie mit Rang 8, Rang 7 schon (Review K1 zu #55). @param {number} rank */
const separateRank = (rank) => (rank + 1) * 1.1 < (MAX_RANK + 1) * 0.9;

/**
 * Würfelglück eines fremden Werts (`offerStatQuality` der App): Verkäufer tragen mal den Wert beim Rang der Auktion, mal den
 * bei Rang 8 ein. Bis Rang 6 zuerst der Rang der Auktion, bei Rang 7 zuerst Rang 8. Beim Nachteil ist ein kleiner Malus
 * Glück (1 − Würfel).
 * @param {BaseValue} stat @param {{ buffs: number, curses: number, curse: boolean }} shape @param {number | undefined} rank @param {number} shown
 */
export function statQuality(stat, shape, rank, shown) {
  const own = rank !== undefined && Number.isInteger(rank) && rank >= 0 && rank < MAX_RANK ? rank : undefined;
  const ranks = own === undefined ? [MAX_RANK] : separateRank(own) ? [own, MAX_RANK] : [MAX_RANK, own];
  for (const tryRank of ranks) {
    const roll = rollFromShown(stat, { ...shape, rank: tryRank }, shown);
    if (roll) {
      const middle = (roll.min + roll.max) / 2;
      return shape.curse ? 1 - middle : middle;
    }
  }
  return undefined;
}

/**
 * Mittel des Würfelglücks aller lesbaren Eigenschaften eines Angebots; `undefined`, wenn keine lesbar ist.
 * @param {{ tag: string, value: number, positive: boolean }[]} values @param {Record<string, BaseValue> | undefined} base @param {number | undefined} rank
 */
export function offerLuck(values, base, rank) {
  if (!base) return undefined;
  const buffs = values.filter((entry) => entry.positive).length;
  const curses = values.length - buffs;
  const qualities = values.flatMap((entry) => {
    const stat = Object.hasOwn(base, entry.tag) ? base[entry.tag] : undefined;
    const quality = stat ? statQuality(stat, { buffs, curses, curse: !entry.positive }, rank, entry.value) : undefined;
    return quality === undefined ? [] : [quality];
  });
  return qualities.length > 0 ? qualities.reduce((sum, quality) => sum + quality, 0) / qualities.length : undefined;
}
