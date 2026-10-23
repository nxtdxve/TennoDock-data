// @ts-check
// Tage in UTC als Text `JJJJ-MM-TT` (#99). Die Tagesdateien von relics.run und das Fenster der Preise rechnen in UTC.

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC-Tag eines Zeitpunkts (ms). */
export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** @param {string} day */
const startOf = (day) => Date.parse(`${day}T00:00:00Z`);

/** Gültiger Tag `JJJJ-MM-TT` (kein 31. Februar). @param {unknown} value @returns {value is string} */
export function isDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(startOf(value)) && utcDay(startOf(value)) === value;
}

/** @param {string} day @param {number} days */
export function addDays(day, days) {
  return utcDay(startOf(day) + days * DAY_MS);
}

/** Ganze Tage von `from` bis `to` (negativ, wenn `to` früher ist). @param {string} from @param {string} to */
export function daysBetween(from, to) {
  return Math.round((startOf(to) - startOf(from)) / DAY_MS);
}

/** Alle Tage des Fensters, das mit `last` endet, ältester zuerst. @param {string} last @param {number} length */
export function windowDays(last, length) {
  return Array.from({ length }, (_, i) => addDays(last, i - length + 1));
}
