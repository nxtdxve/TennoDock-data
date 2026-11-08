// @ts-check
// Baut die Riven-Preise für TennoDock (#172) im öffentlichen Daten-Repo: `rivens/v1/prices.json` mit Spannen der
// Angebotspreise auf warframe.market pro Waffe und Kombination der Vorteile, dazu DEs Wochenwerte echter Riven-Trades pro
// Waffe. Läuft in der GitHub Action (Workflow `rivens.yml`), von Hand mit:
//
//   node rivens-file/build.mjs                       der Lauf von heute (Waffen, deren Tag heute ist, und überfällige)
//   RIVENS_BUDGET=50 node rivens-file/build.mjs      höchstens 50 Suchen
//   RIVENS_WFM=off node rivens-file/build.mjs        ohne warframe.market, nur DEs Wochenwerte
//
// Im TennoDock-Repo liegt das Daten-Repo 1:1 unter `tools/tennodock-data/`; dort aufrufen.
//
// Daves Entscheidungen vom 08.11.2026: rund 500 Suchen am Tag, eine alle 8 s, harte Grenze 1'200; täglich, abschaltbar
// mit der Variable `RIVENS_WFM`; DEs Datei von `www-static.warframe.com` (Host nur für diese Action). Ein Fehler zerstört
// nie die bestehende Datei: Gescheiterte Waffen behalten ihren alten Stand, eine ungültige Datei wird nicht geschrieben.
// Keine Abhängigkeiten ausser Node (ab 20) und `xz` (für den Index des DE-Exports, auf GitHub-Runnern vorhanden).
// Doku: docs/pakete/172-riven-prices.md im App-Repo.

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { folderFiles } from '../glyph-codes-file/build.mjs';
import { DE_FILE_BASE, fetchIndex, parseDeJson, parseIndex, unlzmaWithXz } from '../promo-codes-file/lib/names.mjs';
import { buildFile, checkFile, contentOf, encodeFile, encodeState, FILE, readFile, readState, STATE_FILE } from './lib/file.mjs';
import { pairKey, planRun } from './lib/plan.mjs';
import { offerLuck, readBaseValues } from './lib/rolls.mjs';
import { classOf, curseClass, GAME_ONLY_TAGS, gameTag, marketTag } from './lib/rules.mjs';
import { isFresh, weaponEntries } from './lib/stats.mjs';
import { readWeekly, WEEKLY_URL, weeklyEntry } from './lib/weekly.mjs';
import { ATTRIBUTES_URL, parseAttributes, parseAuctionPage, parseWeapons, searchPair, WEAPONS_URL } from './lib/wfm.mjs';

/** Eigene Kennung mit Projekt und Repo, wie es die Regeln von warframe.market verlangen; keine persönlichen Daten. */
export const USER_AGENT = 'TennoDock-data/1 (+https://github.com/nxtdxve/TennoDock-data; riven price ranges)';
/** Abstand zwischen zwei Anfragen an warframe.market: 7,5 pro Minute, unter „10 to 20“ der Regeln. */
export const SEARCH_GAP_MS = 8000;
/** Harte Grenze pro Lauf (Daves Entscheidung). */
export const DEFAULT_BUDGET = 1200;
const RETRY_MS = 30 * 1000;
const RATE_LIMIT_MS = 60 * 1000;
/** So viele gescheiterte Suchen in Folge beenden die Suche für heute. */
const MAX_FAILURES_IN_ROW = 3;
/** Älter werden DEs Wochenwerte, meldet der Lauf es (Mail von GitHub). */
const DE_STALE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {import('../glyph-codes-file/build.mjs').Files} Files
 * @typedef {{ status: number, text: string }} Response
 * @typedef {(url: string) => Promise<Response>} FetchText Wirft, wenn keine Antwort kommt.
 * @typedef {import('./lib/rolls.mjs').BaseValues} BaseValues
 * @typedef {{ index: string, base?: BaseValues }} BaseValuesAnswer `base` fehlt, wenn der Index unverändert ist.
 * @typedef {import('./lib/file.mjs').WeaponRecord} WeaponRecord
 * @typedef {import('./lib/file.mjs').StateWeapon} StateWeapon
 * @typedef {{ fetchText: FetchText, files: Files, now: number, log(text: string): void, sleep(ms: number): Promise<void>,
 *   wfm?: boolean, budget?: number, gapMs?: number, baseValues?(knownIndex: string | undefined): Promise<BaseValuesAnswer> }} RunDeps
 *   `files`: der Ordner `rivens/`; `wfm`: false = keine Anfrage an warframe.market; `baseValues`: Grundwerte aus dem DE-Export.
 * @typedef {{ written: boolean, asOf: string, searches: number, weapons: number, stopped?: string, deFailed: boolean, deStale: boolean, wfmFailed: boolean }} RunResult
 */

/** UTC-Tag `2026-11-09`. @param {number} ms */
export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** @param {unknown} error */
const message = (error) => (error instanceof Error ? error.message : String(error));

/**
 * Suche bei warframe.market mit Abstand (vor jeder Anfrage, auch nach den Listen), Budget und Rückoff: 429/509 → 60 s,
 * keine Antwort oder 5xx → 30 s, je eine
 * Wiederholung. 403 oder eine Antwort ohne Liste (Seite von Cloudflare) beenden die Suche für heute, ebenso 3 gescheiterte
 * Suchen in Folge und das Ende des Budgets.
 * @param {{ fetchText: FetchText, sleep(ms: number): Promise<void>, gapMs: number, budget: number }} options
 */
export function createSearch({ fetchText, sleep, gapMs, budget }) {
  let used = 0;
  let failuresInRow = 0;
  /** @type {string | undefined} */
  let stopped;
  /** @param {string} url @returns {Promise<import('./lib/wfm.mjs').SearchAnswer>} */
  const search = async (url) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (stopped) return { failed: stopped };
      if (used >= budget) {
        stopped = 'budget';
        return { failed: stopped };
      }
      await sleep(gapMs);
      used++;
      /** @type {Response | undefined} */
      let response;
      try {
        response = await fetchText(url);
      } catch {
        response = undefined;
      }
      if (response?.status === 200) {
        /** @type {{ list: import('./lib/wfm.mjs').Auction[], total: number } | undefined} */
        let page;
        try {
          page = parseAuctionPage(response.text);
        } catch {
          page = undefined;
        }
        if (!page) {
          stopped = 'blocked';
          return { failed: stopped };
        }
        failuresInRow = 0;
        return page;
      }
      if (response?.status === 403) {
        stopped = 'blocked';
        return { failed: stopped };
      }
      const limited = response?.status === 429 || response?.status === 509;
      if (attempt === 1 || !(response === undefined || limited || response.status >= 500)) break;
      await sleep(limited ? RATE_LIMIT_MS : RETRY_MS);
    }
    failuresInRow++;
    if (failuresInRow >= MAX_FAILURES_IN_ROW) stopped = 'failures';
    return { failed: 'error' };
  };
  return { search, used: () => used, stopped: () => stopped };
}

/** Ein Abruf mit einer Wiederholung nach 30 s (keine Antwort, 5xx, 429). @param {RunDeps} deps @param {string} url @returns {Promise<string>} */
async function fetchOk(deps, url) {
  for (let attempt = 0; ; attempt++) {
    /** @type {Response | undefined} */
    let response;
    try {
      response = await deps.fetchText(url);
    } catch (error) {
      if (attempt > 0) throw error;
    }
    if (response?.status === 200) return response.text;
    if (attempt > 0 || (response && response.status !== 429 && response.status < 500)) throw new Error(`HTTP ${response?.status ?? 'no answer'} for ${url}`);
    await deps.sleep(RETRY_MS);
  }
}

/**
 * Ein Lauf: DEs Wochenwerte, die Listen von warframe.market, die Waffen von heute suchen, mit dem alten Stand zusammenführen,
 * prüfen und schreiben, wenn sich etwas geändert hat. Wirft nur, wenn die neue Datei ungültig wäre; dann bleibt die alte.
 * @param {RunDeps} deps @returns {Promise<RunResult>}
 */
export async function run(deps) {
  const { files, now, log } = deps;
  const today = isoDay(now);
  const previous = readFile(await files.read(FILE));
  const state = readState(await files.read(STATE_FILE));
  const wfmOn = deps.wfm !== false;

  // 1. DEs Wochenwerte: ein Abruf; scheitert er, bleiben die alten Werte.
  /** @type {Map<string, import('./lib/weekly.mjs').WeeklyWeapon> | undefined} */
  let weekly;
  try {
    weekly = readWeekly(await fetchOk(deps, WEEKLY_URL));
    log(`Weekly rivens from DE: ${weekly.size} weapons`);
  } catch (error) {
    log(`::warning::Weekly rivens from DE not available (${message(error)}); keeping the last values`);
  }
  const deAt = weekly ? today : previous?.deAt;

  // 2. Listen von warframe.market (2 Abrufe), sonst die Waffen aus dem Merkzettel.
  /** @type {StateWeapon[] | undefined} */
  let weapons = state.weapons;
  /** @type {Map<string, string> | undefined} */
  let tagOfSlug;
  /** @type {string | undefined} */
  let stopped = wfmOn ? undefined : 'off';
  if (wfmOn) {
    try {
      const listed = parseWeapons(await fetchOk(deps, WEAPONS_URL));
      await deps.sleep(deps.gapMs ?? SEARCH_GAP_MS);
      tagOfSlug = parseAttributes(await fetchOk(deps, ATTRIBUTES_URL));
      if (!listed || !tagOfSlug) throw new Error('unreadable lists');
      weapons = listed;
      log(`warframe.market: ${listed.length} riven weapons, ${tagOfSlug.size} attributes`);
    } catch (error) {
      stopped = 'lists';
      tagOfSlug = undefined;
      log(`::warning::warframe.market lists not available (${message(error)}); no searches today`);
    }
  }

  // Index der Eigenschaften: alte Reihenfolge bleibt, neue hinten dran (alte Einträge behalten ihre Indizes).
  const stats = [...(previous?.stats ?? [])];
  const known = tagOfSlug ? [...new Set([...tagOfSlug.values(), ...GAME_ONLY_TAGS])].sort() : [];
  for (const tag of known) if (!stats.includes(tag)) stats.push(tag);
  const indexOf = (/** @type {string} */ tag) => stats.indexOf(tag);
  /** @type {Map<string, string>} */
  const slugOfTag = new Map([...(tagOfSlug ?? new Map())].map(([slug, tag]) => [tag, slug]));

  // 3. Plan: Stufe aus DEs Beliebtheit (heute oder aus der letzten Datei), Tag der letzten Suche, volle Paare.
  const infos = (weapons ?? []).flatMap((weapon) => {
    const de = weekly?.get(weapon.name.toLowerCase());
    const weaponClass = classOf(weapon, de?.itemType);
    if (!weaponClass) return [];
    const last = previous?.weapons[weapon.path];
    // Ohne Zeile in DEs Datei wird die Waffe kaum gehandelt (Stufe C); ohne DEs Datei gilt der Wert der letzten.
    const pop = weekly ? (de?.rolled?.pop ?? 0) : typeof last?.de?.[1] === 'number' ? last.de[1] : undefined;
    return [{ weapon, weaponClass, de, plan: { slug: weapon.slug, path: weapon.path, weaponClass, ...(pop !== undefined ? { pop } : {}), ...(last?.at ? { lastAt: last.at } : {}), ...(state.big?.[weapon.path] ? { big: state.big[weapon.path] } : {}) } }];
  });
  const plan = tagOfSlug && !stopped ? planRun(infos.map((info) => info.plan), now) : [];

  // 4. Grundwerte für das Würfelglück, nur wenn gesucht wird; ohne sie fehlen nur die Glücks-Fenster.
  let base = state.base;
  let exportIndex = state.exportIndex;
  if (plan.length > 0 && deps.baseValues) {
    try {
      const answer = await deps.baseValues(state.exportIndex);
      exportIndex = answer.index;
      if (answer.base) base = answer.base;
    } catch (error) {
      log(`::warning::Riven base values not available (${message(error)}); ${base ? 'using the last ones' : 'no roll luck today'}`);
    }
  }

  // 5. Suchen.
  const budget = deps.budget ?? DEFAULT_BUDGET;
  const searcher = createSearch({ fetchText: deps.fetchText, sleep: deps.sleep, gapMs: deps.gapMs ?? SEARCH_GAP_MS, budget });
  /** @type {Record<string, WeaponRecord>} */
  const searched = {};
  /** @type {Record<string, string[]>} */
  const big = { ...(state.big ?? {}) };
  for (const { weapon, tier, pairs, estimate } of plan) {
    if (searcher.stopped()) break;
    if (searcher.used() + estimate > budget) continue;
    /** @type {{ pair: [string, string], complete: boolean, big: boolean, auctions: import('./lib/wfm.mjs').Auction[] }[]} */
    const results = [];
    let failed = false;
    for (const pair of pairs) {
      const slugs = pair.map((tag) => slugOfTag.get(marketTag(weapon.weaponClass, tag)));
      if (slugs.some((slug) => slug === undefined)) continue;
      const answer = await searchPair(searcher.search, weapon.slug, /** @type {string[]} */ (slugs), (weapon.big ?? []).includes(pairKey(pair)));
      if ('failed' in answer) {
        failed = true;
        break;
      }
      results.push({ pair, ...answer });
    }
    if (failed || results.length === 0) continue;
    const base1 = base?.[weapon.weaponClass];
    /** @type {Map<string, import('./lib/stats.mjs').Offer>} */
    const offers = new Map();
    for (const auction of results.flatMap((result) => result.auctions)) {
      if (offers.has(auction.id) || auction.updated === undefined || !isFresh(auction.updated, now)) continue;
      const values = auction.values.map((entry) => {
        const tag = tagOfSlug?.get(entry.slug);
        return { ...entry, tag: tag === undefined ? undefined : gameTag(weapon.weaponClass, tag) };
      });
      if (values.some((entry) => entry.tag === undefined)) continue;
      const buffs = values.filter((entry) => entry.positive).map((entry) => /** @type {string} */ (entry.tag)).sort();
      const curses = values.filter((entry) => !entry.positive);
      if (buffs.length < 2 || buffs.length > 3 || curses.length > 1) continue;
      const luck = offerLuck(/** @type {{ tag: string, value: number, positive: boolean }[]} */ (values), base1, auction.rank);
      offers.set(auction.id, { id: auction.id, price: auction.price, buffs, ...(curses[0]?.tag ? { curse: curses[0].tag } : {}), updated: auction.updated, ...(luck !== undefined ? { luck } : {}) });
    }
    const c = weaponEntries([...offers.values()], results, (tag) => curseClass(weapon.weaponClass, tag), indexOf);
    const pairKeys = results.map((result) => `${result.pair.map(indexOf).sort((a, b) => a - b).join('.')}${result.complete ? '' : '!'}`);
    searched[weapon.path] = { at: today, pairs: pairKeys, c };
    const full = results.filter((result) => result.big).map((result) => pairKey(result.pair));
    if (full.length > 0) big[weapon.path] = full;
    else delete big[weapon.path];
    log(`${weapon.slug} (${tier}): ${offers.size} offers, ${Object.keys(c).length} entries`);
  }
  stopped ??= searcher.stopped();
  if (stopped && stopped !== 'off') log(`::warning::Searches stopped early (${stopped}) after ${searcher.used()} searches`);

  // 6. Zusammenführen: heute gesuchte Waffen neu, die anderen wie bisher; DEs Werte für alle.
  /** @type {Record<string, WeaponRecord>} */
  const records = {};
  const paths = weapons ? weapons.map((weapon) => weapon.path) : Object.keys(previous?.weapons ?? {});
  const nameOf = new Map((weapons ?? []).map((weapon) => [weapon.path, weapon.name]));
  for (const path of paths) {
    const old = previous?.weapons[path];
    const fresh = searched[path];
    const name = nameOf.get(path);
    const de = weekly ? weeklyEntry(name ? weekly.get(name.toLowerCase()) : undefined) : old?.de;
    const source = fresh ?? old;
    /** @type {WeaponRecord} */
    const record = {};
    if (source?.at) record.at = source.at;
    if (de) record.de = de;
    if (source?.pairs) record.pairs = source.pairs;
    if (source?.c) record.c = source.c;
    if (record.at || record.de) records[path] = record;
  }
  const dates = [deAt, ...Object.values(records).map((record) => record.at)].filter((day) => day !== undefined).sort();
  const asOf = dates.at(-1) ?? today;
  const file = buildFile({ asOf, now, ...(deAt ? { deAt } : {}), stats, weapons: records });
  const errors = checkFile(file);
  if (errors.length > 0) throw new Error(`Invalid riven file, keeping the old one: ${errors.slice(0, 5).join('; ')}`);
  const before = Object.values(previous?.weapons ?? {}).filter((record) => record.c && Object.keys(record.c).length > 0).length;
  const after = Object.values(records).filter((record) => record.c && Object.keys(record.c).length > 0).length;
  if (before >= 20 && after < before * 0.5) throw new Error(`Only ${after} weapons with prices instead of ${before}, keeping the old file`);

  const written = !previous || contentOf(previous) !== contentOf(file);
  if (written) await files.write(FILE, encodeFile(file));
  /** @type {import('./lib/file.mjs').State} */
  const nextState = { v: 1, ...(weapons ? { weapons } : {}), big, ...(exportIndex ? { exportIndex } : {}), ...(base ? { base } : {}) };
  const stateText = encodeState(nextState);
  if (stateText !== (await files.read(STATE_FILE))) await files.write(STATE_FILE, stateText);

  const deStale = !deAt || now - Date.parse(`${deAt}T00:00:00Z`) > DE_STALE_DAYS * DAY_MS;
  return {
    written,
    asOf,
    searches: searcher.used(),
    weapons: Object.keys(searched).length,
    ...(stopped ? { stopped } : {}),
    deFailed: !weekly,
    deStale,
    wfmFailed: wfmOn && (stopped === 'lists' || stopped === 'blocked' || stopped === 'failures'),
  };
}

/**
 * Grundwerte aus DEs `ExportUpgrades_en.json`: erst der Index (rund 0,5 KB, wie bei den Namen der Promo-Codes), die Datei
 * nur, wenn sich ihr Eintrag im Index geändert hat.
 * @param {string | undefined} knownIndex @returns {Promise<BaseValuesAnswer>}
 */
export async function loadBaseValues(knownIndex) {
  /** @param {string} url */
  const get = async (url) => {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(120 * 1000) });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response;
  };
  const indexBytes = await fetchIndex(async (url) => new Uint8Array(await (await get(url)).arrayBuffer()), (text) => console.log(text));
  const line = parseIndex(await unlzmaWithXz(indexBytes)).get('ExportUpgrades');
  if (!line) throw new Error('ExportUpgrades not in the index');
  if (line === knownIndex) return { index: line };
  const base = readBaseValues(parseDeJson(await (await get(`${DE_FILE_BASE}${line}`)).text()));
  if (Object.keys(base).length < 5) throw new Error('too few riven types in ExportUpgrades');
  return { index: line, base };
}

/** Ausgaben für die Schritte des Workflows. @param {RunResult} result */
export function outputLines(result) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.asOf)) throw new Error('Unexpected values for the step outputs');
  return `asOf=${result.asOf}\nsearches=${result.searches}\nweapons=${result.weapons}\nwfm_failed=${result.wfmFailed}\nde_stale=${result.deStale}\n`;
}

/** Abruf mit eigener Kennung und Frist von 2 Minuten. @type {FetchText} */
export async function fetchWithAgent(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(120 * 1000) });
  return { status: response.status, text: await response.text() };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const output = process.env['GITHUB_OUTPUT'];
  const budget = Number(process.env['RIVENS_BUDGET']);
  const result = await run({
    fetchText: fetchWithAgent,
    files: folderFiles(process.env['DATA_DIR'] ?? 'rivens'),
    now: Date.now(),
    log: (text) => console.log(text),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    wfm: process.env['RIVENS_WFM'] !== 'off',
    budget: Number.isInteger(budget) && budget >= 0 ? Math.min(budget, DEFAULT_BUDGET) : DEFAULT_BUDGET,
    baseValues: loadBaseValues,
  });
  console.log(`Riven prices as of ${result.asOf}: ${result.written ? 'written' : 'unchanged'}, ${result.searches} searches, ${result.weapons} weapons`);
  if (output) await writeFile(output, outputLines(result), { flag: 'a' });
  // In der Action melden eigene Schritte nach dem Commit; von Hand scheitert der Lauf gleich.
  else if (result.wfmFailed || result.deStale) process.exitCode = 1;
}
