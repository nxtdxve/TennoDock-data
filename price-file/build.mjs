// @ts-check
// Baut die Tagesdatei der Marktpreise (#99), die Verlaufsdatei der Prime-Sets (#54), die Markt-Analyse (#47) und die
// Ducat-Angebote der Prime-Teile (#202) im öffentlichen Daten-Repo. Läuft
// in der GitHub Action (Workflow `prices.yml`), von Hand mit:
//
//   node price-file/build.mjs                    fehlende Tage holen, Dateien bauen, falls neu
//   REBUILD=1 node price-file/build.mjs          Tagesdatei auch ohne neuen Tag neu bauen (z. B. nach einer Änderung der Regel)
//   TRENDS_BACKFILL=1 node price-file/build.mjs  für den Verlauf fehlende Wochen nachholen, ein Tag pro Woche (einmalig)
//
// Im TennoDock-Repo liegt das Daten-Repo 1:1 unter `tools/tennodock-data/`; dort aufrufen.
//
// Ablauf: Item-Liste (Kennung → Lotus-Pfad) aus dem Repo, sonst von relics.run, sonst von warframe.market. Dann die
// fehlenden Tage des Fensters von relics.run (beim ersten Lauf 14, sonst einer), als kompakte Tage in `prices/days/`.
// Fehlt relics.run seit 2 Tagen, der Rückfall bei warframe.market (`WFM_FALLBACK`: `prime` = Ducat-Liste, 1 Abruf;
// `full` = Statistik pro Item, rund 3'900 Abrufe; `off`). Zum Schluss `prices/v1/prices.json`, nur wenn sie plausibel ist;
// sonst bleibt die alte liegen. Danach `prices/v1/trends.json` aus denselben Tagen (lib/trends.mjs),
// `analytics/v1/market.json` (lib/analytics.mjs) und `ducats/v1/offers.json` (lib/ducats.mjs). Keine Abhängigkeiten ausser
// Node (ab 20). Doku: docs/pakete/99-preise-alle.md, 54-vault-tracker.md, 47-analytics.md und 202-ducatinator.md im App-Repo

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildAnalytics, checkAnalytics, encodeAnalytics, readAnalyticsFile } from './lib/analytics.mjs';
import { addDays, daysBetween, utcDay, windowDays } from './lib/days.mjs';
import { buildDucatOffers, checkDucatOffers, encodeDucatOffers, primeParts, readDucatOffersFile } from './lib/ducats.mjs';
import { buildPrices, checkPrices, encodePrices, readDay, readPriceFile, WINDOW_DAYS, writeDay } from './lib/prices.mjs';
import { compactDucatsDay, compactRelicsDay, DUCATS_URL, parseItems, RELICS_ITEMS_URL, relicsDayUrl, statisticsDays, statisticsUrl, WFM_ITEMS_URL } from './lib/sources.mjs';
import { addTrendDays, checkTrends, dayPrices, decodeTrends, encodeTrends, missingWeeks, primeSets, readTrendFile, settle } from './lib/trends.mjs';

/** Eigene Kennung, wie es die Regeln von warframe.market verlangen (Projekt und Kontakt). */
export const USER_AGENT = 'TennoDock-data/1 (+https://github.com/nxtdxve/TennoDock-data)';
/** Abstand zwischen zwei Tagesdateien von relics.run (nur beim ersten Lauf oder nach einer Lücke). */
const RELICS_GAP_MS = 3000;
/** Abstand beim Vollabruf: unter dem Limit von warframe.market (3 pro Sekunde), wie bei der App (1 pro Sekunde). */
const STATISTICS_GAP_MS = 1200;
const RETRY_MS = 30 * 1000;
const RATE_LIMIT_RETRY_MS = 60 * 1000;
/** Ab so vielen Tagen ohne neue Datei von relics.run greift der Rückfall, und der Lauf meldet es. */
export const FALLBACK_AFTER_DAYS = 2;

/**
 * @typedef {{ status: number, text: string }} Response
 * @typedef {(url: string) => Promise<Response>} FetchText Wirft, wenn keine Antwort kommt.
 * @typedef {{ read(path: string): Promise<string | undefined>, write(path: string, text: string): Promise<void>, list(dir: string): Promise<string[]>, remove(path: string): Promise<void> }} Files
 *   Dateien relativ zum Datenordner (`prices/`).
 * @typedef {'off' | 'prime' | 'full'} Fallback
 * @typedef {{ fetchText: FetchText, files: Files, now: number, log(text: string): void, sleep(ms: number): Promise<void>, fallback?: Fallback, rebuild?: boolean, minItems?: number }} RunDeps
 * @typedef {{ written: boolean, asOf: string, items?: number, relicsBehind: number, warnings: string[] }} RunResult
 * @typedef {{ fetchText: FetchText, files: Files, now: number, log(text: string): void, sleep(ms: number): Promise<void>, backfill?: boolean, minSets?: number }} TrendDeps
 * @typedef {{ written: boolean, asOf: string, sets: number, backfilled: number }} TrendResult
 * @typedef {{ files: Files, out: Files, now: number, log(text: string): void, minItems?: number }} AnalyticsDeps
 *   `files`: Tage in `prices/`; `out`: der Ordner `analytics/`.
 * @typedef {{ written: boolean, asOf: string, items: number, outliers: number }} AnalyticsResult
 * @typedef {{ files: Files, out: Files, now: number, log(text: string): void, minItems?: number }} DucatsDeps
 *   `files`: Item-Liste und Tage in `prices/`; `out`: der Ordner `ducats/`.
 * @typedef {{ written: boolean, asOf: string, items: number }} DucatsResult
 * @typedef {{ fetchText: FetchText, files: Files, now: number, log(text: string): void, sleep(ms: number): Promise<void>, fallback?: Fallback, rebuild?: boolean, backfill?: boolean, minItems?: number, minSets?: number, analyticsFiles?: Files, minAnalyticsItems?: number, ducatsFiles?: Files, minDucatItems?: number }} BuildDeps
 *   `analyticsFiles`: Ordner `analytics/`; ohne ihn keine Analyse (Tests der Tagesdatei). `ducatsFiles`: Ordner `ducats/`
 *   (#202); ohne ihn keine Ducat-Angebote.
 * @typedef {{ failed: boolean, outputs: Record<string, string> }} BuildResult
 */

/**
 * Ein Abruf mit einer Wiederholung nach 30 s bei fehlender Antwort, `5xx` oder `429` (dann 60 s).
 * @param {FetchText} fetchText
 * @param {(ms: number) => Promise<void>} sleep
 * @param {string} url
 */
async function fetchWithRetry(fetchText, sleep, url) {
  try {
    const response = await fetchText(url);
    if (response.status !== 429 && response.status < 500) return response;
    await sleep(response.status === 429 ? RATE_LIMIT_RETRY_MS : RETRY_MS);
  } catch {
    await sleep(RETRY_MS);
  }
  return fetchText(url);
}

/** `[Pfad, Slug, Ducats]`, Ducats 0 ausser bei Prime-Teilen (der dritte Wert seit #202). @param {import('./lib/sources.mjs').Items} items */
const writeItems = (items) => JSON.stringify(Object.fromEntries([...items].sort(([a], [b]) => a.localeCompare(b)).map(([id, item]) => [id, [item.path, item.slug, item.ducats ?? 0]])));

/** @param {string | undefined} text @returns {import('./lib/sources.mjs').Items | undefined} */
function readItems(text) {
  if (!text) return undefined;
  /** @type {import('./lib/sources.mjs').Items} */
  const items = new Map();
  for (const [id, value] of Object.entries(JSON.parse(text))) {
    if (!Array.isArray(value) || typeof value[0] !== 'string' || typeof value[1] !== 'string') continue;
    const ducats = value[2];
    items.set(id, Number.isInteger(ducats) && ducats > 0 ? { path: value[0], slug: value[1], ducats } : { path: value[0], slug: value[1] });
  }
  return items.size > 0 ? items : undefined;
}

/**
 * Liste von vor #202: Einträge ohne dritten Wert, also ohne Ducats der Prime-Teile. Der Lauf lädt sie dann einmal neu.
 * @param {string | undefined} text
 */
function itemsWithoutParts(text) {
  if (!text) return false;
  return Object.values(JSON.parse(text)).some((value) => Array.isArray(value) && value.length === 2);
}

/** @param {RunDeps} deps @returns {Promise<RunResult>} */
export async function run(deps) {
  const { files, log, sleep } = deps;
  const fallback = deps.fallback ?? 'prime';
  const yesterday = addDays(utcDay(deps.now), -1);
  /** @type {string[]} */
  const warnings = [];
  const fetchText = (/** @type {string} */ url) => fetchWithRetry(deps.fetchText, sleep, url);

  // Stand im Repo
  /** @type {Map<string, import('./lib/sources.mjs').CompactDay>} */
  const days = new Map((await readDays(files)).map((day) => [day.day, day]));
  const previousText = await files.read('v1/prices.json');
  const previous = previousText ? readPriceFile(previousText) : undefined;
  const itemsText = await files.read('items.json');
  let items = readItems(itemsText);
  let itemsFresh = false;

  async function loadItems() {
    for (const url of [RELICS_ITEMS_URL, WFM_ITEMS_URL]) {
      try {
        const response = await fetchText(url);
        const list = response.status === 200 ? parseItems(response.text) : undefined;
        if (list) {
          await files.write('items.json', writeItems(list));
          log(`Item list loaded from ${new URL(url).hostname} (${list.size} items)`);
          itemsFresh = true;
          return list;
        }
        log(`Item list from ${new URL(url).hostname} not usable (HTTP ${response.status})`);
      } catch (error) {
        log(`Item list from ${new URL(url).hostname}: no answer (${error instanceof Error ? error.message : String(error)})`);
      }
    }
    return undefined;
  }
  // Eine Liste von vor #202 kennt die Ducats der Prime-Teile nicht: einmal neu laden, sonst die alte behalten.
  if (items && itemsWithoutParts(itemsText)) {
    log('Item list without ducat values, loading it once');
    items = (await loadItems()) ?? items;
  }
  items ??= await loadItems();
  if (!items) throw new Error('No item list (relics.run and warframe.market failed)');

  // Neue Tage von relics.run: alles nach dem neuesten vorhandenen Tag (beim ersten Lauf das ganze Fenster). Lücken davor
  // fragt der Lauf nicht jedes Mal neu ab. Tage aus dem Rückfall werden ersetzt, sobald relics.run sie hat.
  const newestBefore = [...days.values()].filter((day) => day.source === 'relics.run').map((day) => day.day).sort().at(-1);
  let changed = false;
  let fetched = 0;
  for (const day of windowDays(yesterday, WINDOW_DAYS)) {
    const known = days.get(day);
    if (known?.source === 'relics.run' || (!known && newestBefore !== undefined && day < newestBefore)) continue;
    if (fetched++ > 0) await sleep(RELICS_GAP_MS);
    let response;
    try {
      response = await fetchText(relicsDayUrl(day));
    } catch (error) {
      log(`relics.run ${day}: no answer (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    if (response.status !== 200) {
      log(`relics.run ${day}: HTTP ${response.status}`);
      continue;
    }
    let result = compactRelicsDay(response.text, day, items);
    // Unbekannte Kennungen: neue Items, die Liste ist veraltet. Einmal pro Lauf neu laden.
    if (result && result.unknownIds > 0 && !itemsFresh) {
      items = (await loadItems()) ?? items;
      result = compactRelicsDay(response.text, day, items);
    }
    if (!result || Object.keys(result.day.closed).length === 0) {
      log(`relics.run ${day}: no readable trades`);
      continue;
    }
    if (result.unknownIds > 0) log(`relics.run ${day}: ${result.unknownIds} unknown item ids skipped`);
    days.set(day, result.day);
    await files.write(`days/${day}.json`, writeDay(result.day));
    changed = true;
    log(`relics.run ${day}: ${Object.keys(result.day.closed).length} trade rows`);
  }

  // Rückfall bei warframe.market, wenn relics.run seit Tagen fehlt.
  const relicsDays = [...days.values()].filter((day) => day.source === 'relics.run').map((day) => day.day).sort();
  const newestRelics = relicsDays.at(-1);
  const relicsBehind = newestRelics ? daysBetween(newestRelics, yesterday) : WINDOW_DAYS;
  if (relicsBehind >= FALLBACK_AFTER_DAYS) {
    warnings.push(`relics.run has no new file for ${relicsBehind} days (newest: ${newestRelics ?? 'none'})`);
    if (fallback === 'prime') changed = (await primeFallback()) || changed;
    else if (fallback === 'full') changed = (await fullFallback()) || changed;
  }

  async function primeFallback() {
    const response = await fetchText(DUCATS_URL).catch(() => undefined);
    const day = response?.status === 200 ? compactDucatsDay(response.text, items ?? new Map()) : undefined;
    if (!day || days.has(day.day)) return false;
    days.set(day.day, day);
    await files.write(`days/${day.day}.json`, writeDay(day));
    log(`Fallback: ducats ${day.day} (${Object.keys(day.closed).length} prime items)`);
    return true;
  }

  async function fullFallback() {
    const missing = new Set(windowDays(yesterday, WINDOW_DAYS).filter((day) => days.get(day)?.source !== 'relics.run'));
    /** @type {Map<string, Record<string, [number, number]>>} */
    const collected = new Map();
    let answered = 0;
    const list = [...(items ?? new Map()).values()];
    for (const item of list) {
      await sleep(STATISTICS_GAP_MS);
      const response = await fetchText(statisticsUrl(item.slug)).catch(() => undefined);
      const parsed = response?.status === 200 ? statisticsDays(response.text, item.path, missing) : undefined;
      if (!parsed) continue;
      answered++;
      for (const [day, closed] of parsed) collected.set(day, { ...collected.get(day), ...closed });
    }
    // Ohne Antwort für die Hälfte der Items taugt der Abruf nicht (Sperre, Limit): nichts übernehmen.
    if (answered < list.length / 2) {
      warnings.push(`Full fallback answered for ${answered} of ${list.length} items, not used`);
      return false;
    }
    for (const [day, closed] of collected) {
      const compact = /** @type {import('./lib/sources.mjs').CompactDay} */ ({ day, source: 'statistics', closed, offers: {} });
      days.set(day, compact);
      await files.write(`days/${day}.json`, writeDay(compact));
    }
    log(`Fallback: statistics for ${answered} items, ${collected.size} days`);
    return collected.size > 0;
  }

  const asOf = [...days.keys()].sort().at(-1);
  if (!asOf) throw new Error('No day data at all');
  // Tage vor dem Fenster löschen. Das Fenster endet am neuesten Tag, damit bei einem Ausfall die alten Tage bleiben.
  const first = addDays(asOf, -(WINDOW_DAYS - 1));
  for (const day of days.keys()) {
    if (day >= first) continue;
    days.delete(day);
    await files.remove(`days/${day}.json`);
  }

  if (!changed && !deps.rebuild && previous?.asOf === asOf) {
    log(`Up to date (asOf ${asOf})`);
    return { written: false, asOf, relicsBehind, warnings };
  }
  const sources = new Set([...days.values()].map((day) => (day.source === 'relics.run' ? 'relics.run' : 'warframe.market')));
  const file = encodePrices(buildPrices([...days.values()], { asOf }), {
    asOf,
    generatedAt: new Date(deps.now).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: [...sources].sort().join(' + '),
  });
  const reason = checkPrices(file, previous, deps.minItems);
  if (reason) throw new Error(`Prices not written: ${reason}`);
  await files.write('v1/prices.json', JSON.stringify(file));
  log(`Written: v1/prices.json (asOf ${asOf}, ${file.items} items)`);
  return { written: true, asOf, items: file.items, relicsBehind, warnings };
}

/** Die kompakten Tage in `prices/days/`. @param {Files} files */
async function readDays(files) {
  /** @type {import('./lib/sources.mjs').CompactDay[]} */
  const days = [];
  for (const name of await files.list('days')) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
    const text = await files.read(`days/${name}`);
    const day = text ? readDay(text) : undefined;
    if (day && `${day.day}.json` === name) days.push(day);
  }
  return days;
}

/**
 * Verlaufsdatei der Prime-Sets (#54): die Tage aus `prices/days/` eintragen, mit `backfill` fehlende Wochen von relics.run
 * nachholen (ein Donnerstag pro Woche, 3 s Abstand, rund 4 MB pro Tag), prüfen und schreiben, wenn sich etwas geändert hat.
 * @param {TrendDeps} deps
 * @returns {Promise<TrendResult>}
 */
export async function runTrends(deps) {
  const { files, log, sleep } = deps;
  const fetchText = (/** @type {string} */ url) => fetchWithRetry(deps.fetchText, sleep, url);
  const items = readItems(await files.read('items.json'));
  if (!items) throw new Error('Trends: no item list');
  const paths = primeSets(items);
  const days = await readDays(files);
  const previousText = await files.read('v1/trends.json');
  // Eine unlesbare Datei nicht still als leer nehmen: Sonst ersetzte der Lauf zwei Jahre durch die 14 Tage im Fenster.
  let previous;
  try {
    previous = previousText ? readTrendFile(previousText) : undefined;
  } catch {
    previous = undefined;
  }
  if (previousText && !previous) throw new Error('Trends: v1/trends.json is not readable (broken or another format); fix or delete it');
  const asOf = [...days.map((day) => day.day), ...(previous ? [previous.asOf] : [])].sort().at(-1);
  if (!asOf) throw new Error('Trends: no day data');

  const state = decodeTrends(previous);
  addTrendDays(state, days.map((day) => ({ day: day.day, prices: dayPrices(day, paths) })), asOf);
  settle(state, asOf);
  const sources = new Set(days.map((day) => (day.source === 'relics.run' ? 'relics.run' : 'warframe.market')));
  const header = () => ({ asOf, generatedAt: new Date(deps.now).toISOString().replace(/\.\d{3}Z$/, 'Z'), source: [...sources].sort().join(' + ') || 'relics.run' });

  let backfilled = 0;
  if (deps.backfill) {
    const missing = missingWeeks(encodeTrends(state, header()));
    log(`Trends: ${missing.length} weeks to backfill`);
    let fetched = 0;
    for (const day of missing) {
      if (fetched++ > 0) await sleep(RELICS_GAP_MS);
      const response = await fetchText(relicsDayUrl(day)).catch((error) => {
        log(`Trends ${day}: no answer (${error instanceof Error ? error.message : String(error)})`);
        return undefined;
      });
      if (!response) continue;
      if (response.status !== 200) {
        log(`Trends ${day}: HTTP ${response.status}`);
        continue;
      }
      // Eine kaputte Datei (HTML, abgeschnitten, altes Format) kostet nur ihre Woche; die schon geholten bleiben.
      let compact;
      try {
        compact = compactRelicsDay(response.text, day, items);
      } catch {
        log(`Trends ${day}: file not readable`);
        continue;
      }
      const prices = compact ? dayPrices(compact.day, paths) : new Map();
      if (prices.size === 0) {
        log(`Trends ${day}: no readable set prices`);
        continue;
      }
      addTrendDays(state, [{ day, prices }], asOf);
      sources.add('relics.run');
      backfilled++;
      log(`Trends ${day}: ${prices.size} sets`);
    }
    settle(state, asOf);
  }

  const file = encodeTrends(state, header());
  const reason = checkTrends(file, previous, deps.minSets);
  if (reason) throw new Error(`Trends not written: ${reason}`);
  // Ohne Änderung an den Werten kein neuer Commit (nur `generatedAt` wäre anders).
  if (previous && JSON.stringify({ ...previous, generatedAt: '' }) === JSON.stringify({ ...file, generatedAt: '' })) {
    log(`Trends up to date (asOf ${asOf})`);
    return { written: false, asOf, sets: file.items, backfilled };
  }
  await files.write('v1/trends.json', JSON.stringify(file));
  log(`Written: v1/trends.json (asOf ${asOf}, ${file.items} sets, ${backfilled} days backfilled)`);
  return { written: true, asOf, sets: file.items, backfilled };
}

/**
 * Markt-Analyse (#47): Kennzahlen der letzten 7 Tage und der 7 Tage davor aus den Tagen in `prices/days/`, ohne Abruf.
 * Geschrieben nur, wenn sie plausibel ist und sich ausser `generatedAt` etwas geändert hat; sonst bleibt die alte liegen.
 * @param {AnalyticsDeps} deps
 * @returns {Promise<AnalyticsResult>}
 */
export async function runAnalytics(deps) {
  const days = await readDays(deps.files);
  const asOf = days.map((day) => day.day).sort().at(-1);
  if (!asOf) throw new Error('Analytics: no day data');
  const analytics = buildAnalytics(days, { asOf });
  const sources = new Set(days.map((day) => (day.source === 'relics.run' ? 'relics.run' : 'warframe.market')));
  const file = encodeAnalytics(analytics, { generatedAt: new Date(deps.now).toISOString().replace(/\.\d{3}Z$/, 'Z'), source: [...sources].sort().join(' + ') });
  const previousText = await deps.out.read('v1/market.json');
  let previous;
  try {
    previous = previousText ? readAnalyticsFile(previousText) : undefined;
  } catch {
    previous = undefined;
  }
  const reason = checkAnalytics(file, previous, deps.minItems);
  if (reason) throw new Error(`Analytics not written: ${reason}`);
  if (previous && JSON.stringify({ ...previous, generatedAt: '' }) === JSON.stringify({ ...file, generatedAt: '' })) {
    deps.log(`Analytics up to date (asOf ${asOf})`);
    return { written: false, asOf, items: file.items, outliers: analytics.outliers };
  }
  await deps.out.write('v1/market.json', JSON.stringify(file));
  deps.log(`Written: analytics/v1/market.json (asOf ${asOf}, ${file.items} items, ${analytics.outliers} outlier rows left out)`);
  return { written: true, asOf, items: file.items, outliers: analytics.outliers };
}

/**
 * Ducat-Angebote (#202): Angebotsmedian und Zahl der Angebote jedes Prime-Teils am neuesten Tag mit Angeboten, dazu der
 * Median 7 Tage davor, aus den Tagen in `prices/days/`, ohne Abruf. Geschrieben nur, wenn sie plausibel ist und sich ausser
 * `generatedAt` etwas geändert hat; sonst bleibt die alte liegen.
 * @param {DucatsDeps} deps
 * @returns {Promise<DucatsResult>}
 */
export async function runDucats(deps) {
  const items = readItems(await deps.files.read('items.json'));
  if (!items) throw new Error('Ducats: no item list');
  const parts = primeParts(items);
  if (parts.size === 0) throw new Error('Ducats: the item list has no Prime parts with ducats');
  const offers = buildDucatOffers(await readDays(deps.files), parts);
  if (!offers) throw new Error('Ducats: no day with offers for Prime parts');
  const file = encodeDucatOffers(offers, { generatedAt: new Date(deps.now).toISOString().replace(/\.\d{3}Z$/, 'Z') });
  const previousText = await deps.out.read('v1/offers.json');
  let previous;
  try {
    previous = previousText ? readDucatOffersFile(previousText) : undefined;
  } catch {
    previous = undefined;
  }
  const reason = checkDucatOffers(file, previous, deps.minItems);
  if (reason) throw new Error(`Ducats not written: ${reason}`);
  if (previous && JSON.stringify({ ...previous, generatedAt: '' }) === JSON.stringify({ ...file, generatedAt: '' })) {
    deps.log(`Ducats up to date (asOf ${file.asOf})`);
    return { written: false, asOf: file.asOf, items: file.items };
  }
  await deps.out.write('v1/offers.json', JSON.stringify(file));
  deps.log(`Written: ducats/v1/offers.json (asOf ${file.asOf}, ${file.items} parts${file.weekAgo ? `, compared with ${file.weekAgo}` : ''})`);
  return { written: true, asOf: file.asOf, items: file.items };
}

/**
 * Tagesdatei, dann Verlauf, Analyse und Ducat-Angebote. Die drei laufen auch, wenn die Tagesdatei nicht geschrieben wurde
 * (sie brauchen nur die Tage), und ihr Fehler hält die Tagesdatei nie auf: `failed` gilt nur für die Tagesdatei, Fehler
 * stehen in `outputs.trends_failed`, `outputs.analytics_failed` und `outputs.ducats_failed`. Die Action meldet sie erst nach
 * dem Commit (Schritte „Report trends“, „Report analytics“ und „Report ducats“).
 * @param {BuildDeps} deps
 * @returns {Promise<BuildResult>}
 */
export async function build(deps) {
  /** @type {Record<string, string>} */
  const outputs = {};
  let failed = false;
  const message = (/** @type {unknown} */ error) => (error instanceof Error ? error.message : String(error));
  try {
    const result = await run(deps);
    // Warnungen als Anmerkung im Actions-Tab; der Workflow lässt den Lauf danach scheitern, damit GitHub eine Mail schickt.
    for (const warning of result.warnings) deps.log(`::warning::${warning}`);
    outputs['stale'] = String(result.warnings.length > 0);
    outputs['asOf'] = result.asOf;
  } catch (error) {
    deps.log(`::error::${message(error)}`);
    failed = true;
  }
  try {
    await runTrends(deps);
    outputs['trends_failed'] = 'false';
  } catch (error) {
    deps.log(`::error::${message(error)}`);
    outputs['trends_failed'] = 'true';
  }
  if (deps.analyticsFiles) {
    try {
      await runAnalytics({ files: deps.files, out: deps.analyticsFiles, now: deps.now, log: deps.log, ...(deps.minAnalyticsItems !== undefined ? { minItems: deps.minAnalyticsItems } : {}) });
      outputs['analytics_failed'] = 'false';
    } catch (error) {
      deps.log(`::error::${message(error)}`);
      outputs['analytics_failed'] = 'true';
    }
  }
  if (deps.ducatsFiles) {
    try {
      await runDucats({ files: deps.files, out: deps.ducatsFiles, now: deps.now, log: deps.log, ...(deps.minDucatItems !== undefined ? { minItems: deps.minDucatItems } : {}) });
      outputs['ducats_failed'] = 'false';
    } catch (error) {
      deps.log(`::error::${message(error)}`);
      outputs['ducats_failed'] = 'true';
    }
  }
  return { failed, outputs };
}

/** Dateien im Ordner `root`. @param {string} root @returns {Files} */
export function folderFiles(root) {
  return {
    read: (path) => readFile(join(root, path), 'utf8').catch(() => undefined),
    async write(path, text) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    },
    list: (dir) => readdir(join(root, dir)).catch(() => []),
    remove: (path) => rm(join(root, path), { force: true }),
  };
}

/** Abruf mit eigener Kennung und Frist von 2 Minuten. @type {FetchText} */
export async function fetchWithAgent(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(120 * 1000) });
  return { status: response.status, text: await response.text() };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const fallback = process.env['WFM_FALLBACK'];
  const output = process.env['GITHUB_OUTPUT'];
  const { failed, outputs } = await build({
    fetchText: fetchWithAgent,
    files: folderFiles(process.env['DATA_DIR'] ?? 'prices'),
    now: Date.now(),
    log: (text) => console.log(text),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    fallback: fallback === 'off' || fallback === 'full' ? fallback : 'prime',
    rebuild: ['1', 'true'].includes(process.env['REBUILD'] ?? ''),
    backfill: ['1', 'true'].includes(process.env['TRENDS_BACKFILL'] ?? ''),
    analyticsFiles: folderFiles(process.env['ANALYTICS_DIR'] ?? 'analytics'),
    ducatsFiles: folderFiles(process.env['DUCATS_DIR'] ?? 'ducats'),
  });
  if (output) await writeFile(output, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''), { flag: 'a' });
  // In der Action melden eigene Schritte Verlauf, Analyse und Ducats nach dem Commit; von Hand scheitert der Lauf gleich.
  if (failed || (!output && ['trends_failed', 'analytics_failed', 'ducats_failed'].some((key) => outputs[key] === 'true'))) process.exitCode = 1;
}
