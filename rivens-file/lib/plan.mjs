// @ts-check
// Welche Waffen ein Lauf sucht (#172, Daves Entscheidung vom 08.11.2026: rund 500 Suchen am Tag, harte Grenze 1'200).
// Stufen nach DEs Beliebtheit gerollter Rivens: A (`pop` ≥ 5) und B (2 bis 4) alle 3 Tage mit allen Paaren der Kernwerte,
// C (seltener) einmal pro Woche mit zwei Paaren. Jede Waffe hat einen festen Tag in ihrer Runde (aus dem Slug), damit sich
// die Last gleichmässig verteilt; was nie oder vor zu langer Zeit gesucht wurde, kommt danach dran.

import { keyPairs, rarePairs } from './rules.mjs';

/** @typedef {import('./rules.mjs').WeaponClass} WeaponClass */
/** @typedef {'A' | 'B' | 'C'} Tier */
/**
 * @typedef {{ slug: string, path: string, weaponClass: WeaponClass, pop?: number, lastAt?: string, big?: readonly string[] }} PlanWeapon
 *   `pop`: DEs Beliebtheit gerollter Rivens; `lastAt`: Tag der letzten Suche; `big`: Paare, die zuletzt 100 Treffer hatten.
 * @typedef {{ weapon: PlanWeapon, tier: Tier, pairs: [string, string][], estimate: number }} PlannedWeapon
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Tage einer Runde pro Stufe. @type {Readonly<Record<Tier, number>>} */
export const PERIOD_DAYS = { A: 3, B: 3, C: 7 };

/** Stufe; ohne DE-Wert A, wenn ein Paar zuletzt 100 Treffer hatte, sonst C. @param {PlanWeapon} weapon @returns {Tier} */
export function tierOf(weapon) {
  if (weapon.pop === undefined) return (weapon.big?.length ?? 0) > 0 ? 'A' : 'C';
  return weapon.pop >= 5 ? 'A' : weapon.pop >= 2 ? 'B' : 'C';
}

/** Fester Tag in der Runde aus dem Slug (FNV-1a). @param {string} slug @param {number} period */
export function slotOf(slug, period) {
  let hash = 0x811c9dc5;
  for (const char of slug) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return hash % period;
}

/** Schlüssel eines Paars für `big` und die Datei-Logik: Tags sortiert, mit `+`. @param {readonly string[]} pair */
export const pairKey = (pair) => [...pair].sort().join('+');

/** UTC-Tag als Zahl. @param {number} ms */
const dayIndex = (ms) => Math.floor(ms / DAY_MS);

/**
 * Die Waffen dieses Laufs in der Reihenfolge der Suche: erst die, deren Tag heute ist (A vor B vor C, beliebte zuerst),
 * dann überfällige (nie gesucht oder älter als die Runde plus einen Tag, älteste zuerst). Heute schon gesucht: nie.
 * `estimate`: Suchen, wenn nichts voll ist bzw. die vollen Paare geteilt werden (3 pro Paar mit `big`).
 * @param {readonly PlanWeapon[]} weapons @param {number} now @returns {PlannedWeapon[]}
 */
export function planRun(weapons, now) {
  const today = dayIndex(now);
  /** @type {{ planned: PlannedWeapon, slotDue: boolean, age: number }[]} */
  const due = [];
  for (const weapon of weapons) {
    const tier = tierOf(weapon);
    const period = PERIOD_DAYS[tier];
    const last = weapon.lastAt ? Date.parse(`${weapon.lastAt}T00:00:00Z`) : NaN;
    const age = Number.isFinite(last) ? today - dayIndex(last) : Number.POSITIVE_INFINITY;
    if (age < 1) continue;
    const slotDue = today % period === slotOf(weapon.slug, period);
    if (!slotDue && age <= period) continue;
    const pairs = tier === 'C' ? rarePairs(weapon.weaponClass) : keyPairs(weapon.weaponClass);
    const big = new Set(weapon.big ?? []);
    const estimate = pairs.reduce((sum, pair) => sum + (big.has(pairKey(pair)) ? 3 : 1), 0);
    due.push({ planned: { weapon, tier, pairs, estimate }, slotDue, age });
  }
  const tierRank = { A: 0, B: 1, C: 2 };
  return due
    .sort((a, b) => {
      if (a.slotDue !== b.slotDue) return a.slotDue ? -1 : 1;
      if (!a.slotDue && a.age !== b.age) return b.age - a.age;
      return tierRank[a.planned.tier] - tierRank[b.planned.tier] || (b.planned.weapon.pop ?? 0) - (a.planned.weapon.pop ?? 0) || a.planned.weapon.slug.localeCompare(b.planned.weapon.slug);
    })
    .map((entry) => entry.planned);
}
