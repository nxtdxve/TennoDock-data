// @ts-check
// Baut die Liste der aktiven Promo-Codes (#135) im öffentlichen Daten-Repo: `promo-codes/v1/codes.json` mit Code, Anlass,
// Beginn und Ende, dem Tag, an dem der Code zuerst in der Liste stand, und den Belohnungen samt Item im Spiel. Läuft in der
// GitHub Action (Workflow `promo-codes.yml`), von Hand mit:
//
//   node promo-codes-file/build.mjs              Seite „Promo Codes“ im WARFRAME Wiki holen, Datei schreiben, wenn sich etwas geändert hat
//   REBUILD=1 node promo-codes-file/build.mjs    dazu Belohnungen ohne Item neu zuordnen
//
// Im TennoDock-Repo liegt das Daten-Repo 1:1 unter `tools/tennodock-data/`; dort aufrufen.
//
// Quelle: WARFRAME Wiki (wiki.warframe.com), Seite „Promo Codes“, Lizenz CC BY-NC-SA 3.0; ein Abruf pro Lauf über die
// MediaWiki-API. Namen der Items: `names.mjs` (DE-Export, Rückfall public-export-plus), nur geladen, wenn eine Belohnung
// neu ist; bei der Neuzuordnung nur, wenn sich der Index des DE-Exports geändert hat (`namesIndex`). Keine Abhängigkeiten
// ausser Node (ab 20) und `xz` (auf GitHub-Runnern vorhanden). Doku: docs/pakete/135-promo-codes.md im App-Repo.

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { folderFiles, outputLines, readRevision } from '../glyph-codes-file/build.mjs';
import { CODE } from '../glyph-codes-file/lib/glyph-codes.mjs';
import { loadNames } from './lib/names.mjs';
import { parsePromoPage } from './lib/promo-codes.mjs';
import { rewardPath } from './lib/rewards.mjs';

export const PAGE = 'Promo Codes';
export const SOURCE = 'wiki.warframe.com';
export const PAGE_URL = 'https://wiki.warframe.com/w/Promo_Codes';
export const LICENSE = 'CC BY-NC-SA 3.0';
export const API_URL = `https://wiki.warframe.com/api.php?${new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'ids|content|timestamp', rvslots: 'main', titles: PAGE, format: 'json', formatversion: '2', maxlag: '5' })}`;
export const FILE = 'v1/codes.json';
// Mit Kontakt, wie es die User-Agent-Regeln der Wiki-Betreiber erwarten: Projekt und Repo, keine E-Mail.
export const USER_AGENT = 'TennoDock-data/1 (+https://github.com/nxtdxve/TennoDock-data; list of active promo codes)';
const FORMAT = 'tennodock-promo-codes';
const VERSION = 1;
/** Plausibel ist eine Seite, deren Tabelle der abgelaufenen Codes mindestens so viele Zeilen hat (eine geleerte Seite nicht). */
const MIN_INACTIVE_ROWS = 20;
/** Mehr aktive Codes gab es nie (2026 höchstens 9); viel mehr deutet auf eine kaputte oder umgebaute Seite. */
export const MAX_ACTIVE = 40;
/** Ab so vielen Codes, die ohne abgelaufenes Ende verschwinden und nicht unter „Inactive Codes“ stehen (und mehr als der Hälfte), scheitert der Lauf. */
const MIN_VANISHED = 3;
/** So lange merkt sich die Datei `firstSeen` entfernter Codes: Kommen sie nach einem Revert zurück, sind sie nicht „neu“. */
export const REMEMBER_DAYS = 30;
const ATTEMPTS = 3;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {{ text: string, path?: string }} PromoReward Text aus dem Wiki (Englisch) und, falls zugeordnet, das Item im Spiel.
 * @typedef {{ code: string, context?: string, from?: string, until?: string, firstSeen?: string, rewards: PromoReward[] }} PromoCode
 *   `firstSeen` fehlt bei Codes, die schon beim ersten Lauf in der Liste standen und keinen Beginn haben.
 * @typedef {{ code: string, firstSeen?: string, removedOn: string }} RemovedCode Code, der nicht mehr aktiv ist, mit seinem
 *   `firstSeen`; bleibt `REMEMBER_DAYS` nach `removedOn` in der Datei.
 * @typedef {{ format: string, v: number, asOf: string, revisedAt: string, generatedAt: string, source: string, page: string, revision: number, license: string, namesIndex?: string, codes: PromoCode[], removed?: RemovedCode[] }} PromoCodesFile
 *   `namesIndex`: Hash des DE-Index, aus dem die Namen zuletzt kamen.
 * @typedef {import('../glyph-codes-file/build.mjs').Revision} Revision
 * @typedef {import('../glyph-codes-file/build.mjs').Files} Files
 * @typedef {import('../glyph-codes-file/build.mjs').FetchText} FetchText
 * @typedef {import('../glyph-codes-file/build.mjs').RunResult} RunResult
 * @typedef {import('./lib/names.mjs').Names} Names
 * @typedef {{ fetchText: FetchText, files: Files, now: number, log(text: string): void, names(knownHash?: string): Promise<Names>, rebuild?: boolean, sleep?(ms: number): Promise<void> }} RunDeps
 *   `names`: Namen der Items (`names.mjs`), nur aufgerufen, wenn eine Belohnung zuzuordnen ist; mit `knownHash` (nur
 *   Neuzuordnung) ohne Download, solange der DE-Index gleich ist. `rebuild`: auch Belohnungen ohne Item neu zuordnen.
 */

/** @param {string} text */
function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Tag (UTC) eines Zeitpunkts. @param {number} at */
const dayOf = (at) => new Date(at).toISOString().slice(0, 10);

/**
 * Aktive Codes der Seite, jeder einmal (ohne Gross- und Kleinschreibung), in der Reihenfolge des Wikis; Codes, deren Ende
 * laut Wiki vor `today` liegt, fallen weg. Dazu die Codes unter „Inactive Codes“ (klein geschrieben). Wirft, wenn die
 * Seite nicht ganz aussieht: zu wenig inaktive Zeilen, mehr als `MAX_ACTIVE` aktive Codes oder eine aktive Zeile mit
 * Belohnung, deren Code-Zelle sich nicht lesen lässt (z. B. ein Code in einer Vorlage, Review M1). Zeilen ohne Code und ohne
 * Belohnung oder mit einem Platzhalter wie „TBA“ zählen nicht. Steht in der Code-Zelle eine Beschreibung statt eines Codes
 * (z. B. „DUVIRI-(Warframe name)“), fällt die Zeile mit einer Warnung in `warnings` weg: Ein roter Lauf würde sonst alle
 * anderen Codes wochenlang blockieren (2023 stand so eine Zeile zweieinhalb Monate dort).
 * @param {string} source @param {string} today @returns {{ codes: PromoCode[], inactive: Set<string>, warnings: string[] }}
 */
export function readPage(source, today) {
  const { active, inactive } = parsePromoPage(source);
  if (inactive.length < MIN_INACTIVE_ROWS) throw new Error(`Only ${inactive.length} rows under "Inactive Codes"; check the form of the page`);
  const seen = new Set();
  /** @type {PromoCode[]} */
  const codes = [];
  /** @type {string[]} */
  const warnings = [];
  for (const row of active) {
    if (row.until && row.until < today) continue;
    if (row.codes.length === 0 && row.rewards.length > 0) {
      if (row.noCode === 'unreadable') throw new Error(`A row under "Active Codes" has rewards ("${row.rewards[0]}") but no code the script can read; check the form of the page`);
      if (row.noCode === 'description') warnings.push(`A row under "Active Codes" describes a code instead of naming one; skipped (rewards "${row.rewards[0]}")`);
    }
    // Belohnungen nur in einer unbekannten Vorlage: kein stiller Wegfall (Review R2).
    if (row.unreadRewards) warnings.push(`A row under "Active Codes" has rewards the script cannot read (${row.codes.length > 0 ? `code "${row.codes[0]}"` : 'no code'}); check the form of the page`);
    for (const code of row.codes) {
      if (seen.has(code.toLowerCase())) continue;
      seen.add(code.toLowerCase());
      const { context, from, until } = row;
      codes.push({
        code,
        ...(context && { context }),
        ...(from && { from }),
        ...(until && { until }),
        rewards: row.rewards.map((text) => ({ text })),
      });
    }
  }
  if (codes.length > MAX_ACTIVE) throw new Error(`${codes.length} active codes, more than ${MAX_ACTIVE}; check the form of the page`);
  return { codes, inactive: new Set(inactive.flatMap((row) => row.codes.map((code) => code.toLowerCase()))), warnings };
}

/** Nur die aktiven Codes (`readPage`). @param {string} source @param {string} today @returns {PromoCode[]} */
export const activeCodes = (source, today) => readPage(source, today).codes;

/**
 * Wirft, wenn viele Codes auf einmal verschwinden, ohne dass ihr Ende erreicht ist oder sie unter „Inactive Codes“ stehen:
 * eher eine beschädigte Tabelle als eine Aufräumaktion. Die Datei bleibt dann, wie sie ist.
 * @param {PromoCode[]} codes @param {Set<string>} inactive @param {PromoCodesFile} previous @param {string} today
 */
export function checkVanished(codes, inactive, previous, today) {
  const current = new Set(codes.map((entry) => entry.code.toLowerCase()));
  const vanished = previous.codes.filter((entry) => !current.has(entry.code.toLowerCase()) && !inactive.has(entry.code.toLowerCase()) && !(entry.until && entry.until < today));
  if (vanished.length >= MIN_VANISHED && vanished.length * 2 > previous.codes.length) {
    throw new Error(`${vanished.length} of ${previous.codes.length} codes left "Active Codes" without an end date and are not under "Inactive Codes"; check the page`);
  }
}

/**
 * `firstSeen` aus der bisherigen Datei, auch von Codes, die bis zu `REMEMBER_DAYS` Tage weg waren (Revert nach Vandalismus);
 * ein wirklich neuer Code bekommt `today`. Beim ersten Lauf (ohne Datei) gilt der Beginn laut Wiki, sonst bleibt der Wert
 * leer: Sonst wären alle Codes am ersten Tag „neu“ und jede App meldete sie. Entfernte Codes mit `firstSeen` kommen in
 * `removed`.
 * @param {PromoCode[]} codes @param {PromoCodesFile | undefined} previous @param {string} today
 * @returns {{ codes: PromoCode[], removed: RemovedCode[] }}
 */
export function withFirstSeen(codes, previous, today) {
  /** @type {Map<string, string | undefined>} */
  const before = new Map([
    ...(previous?.removed ?? []).map((entry) => /** @type {const} */ ([entry.code.toLowerCase(), entry.firstSeen])),
    ...(previous?.codes ?? []).map((entry) => /** @type {const} */ ([entry.code.toLowerCase(), entry.firstSeen])),
  ]);
  const next = codes.map((entry) => {
    const key = entry.code.toLowerCase();
    const firstSeen = previous ? (before.has(key) ? before.get(key) : today) : entry.from;
    return { ...entry, ...(firstSeen && { firstSeen }) };
  });
  const current = new Set(codes.map((entry) => entry.code.toLowerCase()));
  const cutoff = dayOf(Date.parse(`${today}T00:00:00Z`) - REMEMBER_DAYS * DAY_MS);
  /** @type {RemovedCode[]} */
  const removed = [
    // Auch ohne `firstSeen` (schon vor der Liste da): Kommt so ein Code zurück, bleibt er ohne „New“ (Review R2).
    ...(previous?.codes ?? []).flatMap((entry) => (current.has(entry.code.toLowerCase()) ? [] : [{ code: entry.code, ...(entry.firstSeen && { firstSeen: entry.firstSeen }), removedOn: today }])),
    ...(previous?.removed ?? []).filter((entry) => !current.has(entry.code.toLowerCase()) && entry.removedOn >= cutoff),
  ];
  return { codes: next, removed };
}

/**
 * Items der Belohnungen: aus der bisherigen Datei, wenn derselbe Text schon zugeordnet ist; sonst über `names` (einmal
 * pro Lauf geladen). Texte, die schon ohne Item in der Datei stehen, nur bei `rebuild`, und dann nur, wenn sich der
 * DE-Index seit der letzten Zuordnung geändert hat.
 * @param {PromoCode[]} codes @param {PromoCodesFile | undefined} previous @param {RunDeps['names']} names @param {boolean} rebuild
 * @returns {Promise<{ codes: PromoCode[], resolved: boolean, namesIndex?: string }>}
 */
export async function withPaths(codes, previous, names, rebuild) {
  /** @type {Map<string, string | undefined>} */
  const known = new Map();
  for (const reward of (previous?.codes ?? []).flatMap((entry) => entry.rewards)) if (!known.get(reward.text)) known.set(reward.text, reward.path);
  const rewards = codes.flatMap((entry) => entry.rewards);
  const fresh = rewards.some((reward) => !known.has(reward.text));
  // Ohne Hash in der Datei war die letzte Zuordnung unvollständig (Rückfall oder keine Namen): dann bei jedem Lauf nachholen.
  const again = rebuild || !previous?.namesIndex;
  const retry = again && rewards.some((reward) => known.has(reward.text) && !known.get(reward.text));
  const loaded = fresh ? await names() : retry ? await names(previous?.namesIndex) : undefined;
  const index = loaded?.index;
  const pathOf = (/** @type {string} */ text) => (index && (!known.has(text) || (again && !known.get(text))) ? rewardPath(text, index) : known.get(text));
  // Den Hash merkt sich die Datei nur nach einer Zuordnung aus dem DE-Export (oder unverändertem Index).
  const namesIndex = loaded ? loaded.hash : previous?.namesIndex;
  return {
    codes: codes.map((entry) => ({ ...entry, rewards: entry.rewards.map(({ text }) => ({ text, ...(pathOf(text) && { path: pathOf(text) }) })) })),
    resolved: index !== undefined,
    ...(namesIndex && { namesIndex }),
  };
}

/**
 * Datei aus einer Fassung der Seite und den fertigen Codes.
 * @param {Revision} revision @param {PromoCode[]} codes @param {number} now @param {string} [namesIndex] @param {RemovedCode[]} [removed]
 * @returns {PromoCodesFile}
 */
export function buildFile(revision, codes, now, namesIndex, removed = []) {
  return {
    format: FORMAT,
    v: VERSION,
    asOf: revision.revisedAt.slice(0, 10),
    revisedAt: revision.revisedAt,
    generatedAt: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: SOURCE,
    page: PAGE_URL,
    revision: revision.revision,
    license: LICENSE,
    ...(namesIndex && { namesIndex }),
    codes,
    ...(removed.length > 0 && { removed }),
  };
}

/**
 * Bisherige Datei, wenn sie lesbar ist; Einträge, die keine Codes sein können, fallen weg.
 * @param {string | undefined} text @returns {PromoCodesFile | undefined}
 */
export function readPromoCodesFile(text) {
  const value = text === undefined ? undefined : parse(text);
  if (!isRecord(value) || value['format'] !== FORMAT || value['v'] !== VERSION || !Array.isArray(value['codes'])) return undefined;
  const codes = value['codes'].filter(
    (entry) =>
      isRecord(entry) &&
      typeof entry['code'] === 'string' &&
      CODE.test(entry['code']) &&
      (entry['firstSeen'] === undefined || (typeof entry['firstSeen'] === 'string' && DAY.test(entry['firstSeen']))) &&
      Array.isArray(entry['rewards']) &&
      entry['rewards'].every((reward) => isRecord(reward) && typeof reward['text'] === 'string'),
  );
  const removed = (Array.isArray(value['removed']) ? value['removed'] : []).filter(
    (entry) =>
      isRecord(entry) &&
      typeof entry['code'] === 'string' &&
      CODE.test(entry['code']) &&
      typeof entry['removedOn'] === 'string' &&
      DAY.test(entry['removedOn']) &&
      (entry['firstSeen'] === undefined || (typeof entry['firstSeen'] === 'string' && DAY.test(entry['firstSeen']))),
  );
  const { namesIndex, codes: _codes, removed: _removed, ...rest } = value;
  return /** @type {PromoCodesFile} */ ({ ...rest, ...(typeof namesIndex === 'string' && /^[0-9a-f]{16}$/.test(namesIndex) && { namesIndex }), codes, ...(removed.length > 0 && { removed }) });
}

/** Inhalt ohne Zeit des Laufs, zum Vergleich. @param {PromoCodesFile} file */
const content = ({ generatedAt: _generatedAt, ...rest }) => JSON.stringify(rest);

/**
 * Seite holen; bei 429, 5xx und `maxlag` bis zu dreimal mit Pause (Angabe des Servers, sonst 10 s, 20 s).
 * @param {RunDeps} deps @returns {Promise<unknown>}
 */
async function fetchPage(deps) {
  const sleep = deps.sleep ?? ((/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms)));
  for (let attempt = 1; ; attempt++) {
    const response = await deps.fetchText(API_URL);
    const json = response.status === 200 ? parse(response.text) : undefined;
    const error = isRecord(json) && isRecord(json['error']) ? String(json['error']['code']) : undefined;
    const busy = response.status === 429 || response.status >= 500 || error === 'maxlag';
    if (busy && attempt < ATTEMPTS) {
      await sleep(response.retryAfter ? response.retryAfter * 1000 : 10_000 * attempt);
      continue;
    }
    if (response.status !== 200) throw new Error(`HTTP ${response.status} for ${API_URL}`);
    if (json === undefined) throw new Error(`Not JSON: ${API_URL}`);
    if (error) throw new Error(`Wiki API error: ${error}`);
    return json;
  }
}

/** @param {RunDeps} deps @returns {Promise<RunResult>} */
export async function run(deps) {
  const { files, log, now } = deps;
  const revision = readRevision(await fetchPage(deps));
  if (!revision) throw new Error(`No page ${PAGE} in the answer of the wiki`);
  const today = dayOf(now);
  const previous = readPromoCodesFile(await files.read(FILE));
  const page = readPage(revision.text, today);
  for (const warning of page.warnings) log(`::warning::${warning}`);
  if (previous) checkVanished(page.codes, page.inactive, previous, today);
  const seen = withFirstSeen(page.codes, previous, today);
  const { codes, resolved, namesIndex } = await withPaths(seen.codes, previous, deps.names, deps.rebuild ?? false);
  const file = buildFile(revision, codes, now, namesIndex, seen.removed);
  const result = {
    asOf: file.asOf,
    revision: file.revision,
    codes: file.codes.length,
  };
  const rewards = codes.flatMap((entry) => entry.rewards);
  const matched = `${rewards.filter((reward) => reward.path).length} of ${rewards.length} rewards matched${resolved ? '' : ' (from the file)'}`;
  // Ohne Änderung bleibt die Datei, wie sie ist (kein Commit, kein neuer ETag, kein neuer Download in der App).
  if (previous && content(previous) === content(file)) {
    log(`Promo codes up to date (revision ${file.revision}, ${file.revisedAt}, ${file.codes.length} codes, ${matched})`);
    return { written: false, ...result };
  }
  await files.write(FILE, `${JSON.stringify(file)}\n`);
  log(`Written: ${FILE} (${file.codes.length} codes, ${matched}, revision ${file.revision} of ${file.revisedAt})`);
  return { written: true, ...result };
}

/** Abruf mit eigener Kennung und Frist. @type {FetchText} */
export async function fetchWithAgent(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(60 * 1000),
  });
  const retryAfter = Number(response.headers.get('retry-after') ?? 0);
  return {
    status: response.status,
    text: await response.text(),
    ...(retryAfter > 0 ? { retryAfter } : {}),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const output = process.env['GITHUB_OUTPUT'];
  try {
    const log = (/** @type {string} */ text) => console.log(text);
    const names = (/** @type {string | undefined} */ knownHash) => loadNames({ userAgent: USER_AGENT, log, ...(knownHash && { knownHash }) });
    const result = await run({
      fetchText: fetchWithAgent,
      files: folderFiles(process.env['DATA_DIR'] ?? 'promo-codes'),
      now: Date.now(),
      log,
      names,
      rebuild: process.env['REBUILD'] === '1',
    });
    if (output) await writeFile(output, outputLines(result), { flag: 'a' });
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
