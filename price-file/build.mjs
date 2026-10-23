// @ts-check
// Baut die Tagesdatei der Marktpreise (#99) im öffentlichen Daten-Repo. Läuft in der GitHub Action (Workflow
// `prices.yml`), von Hand mit:
//
//   node price-file/build.mjs            fehlende Tage holen, Datei bauen, falls neu
//   REBUILD=1 node price-file/build.mjs  Datei auch ohne neuen Tag neu bauen (z. B. nach einer Änderung der Regel)
//
// Im TennoDock-Repo liegt das Daten-Repo 1:1 unter `tools/tennodock-data/`; dort aufrufen.
//
// Ablauf: Item-Liste (Kennung → Lotus-Pfad) aus dem Repo, sonst von relics.run, sonst von warframe.market. Dann die
// fehlenden Tage des Fensters von relics.run (beim ersten Lauf 14, sonst einer), als kompakte Tage in `prices/days/`.
// Fehlt relics.run seit 2 Tagen, der Rückfall bei warframe.market (`WFM_FALLBACK`: `prime` = Ducat-Liste, 1 Abruf;
// `full` = Statistik pro Item, rund 3'900 Abrufe; `off`). Zum Schluss `prices/v1/prices.json`, nur wenn sie plausibel ist;
// sonst bleibt die alte liegen. Keine Abhängigkeiten ausser Node (ab 20). Doku: docs/pakete/99-preise-alle.md im App-Repo

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addDays, daysBetween, utcDay, windowDays } from './lib/days.mjs';
import { buildPrices, checkPrices, encodePrices, readDay, readPriceFile, WINDOW_DAYS, writeDay } from './lib/prices.mjs';
import { compactDucatsDay, compactRelicsDay, DUCATS_URL, parseItems, RELICS_ITEMS_URL, relicsDayUrl, statisticsDays, statisticsUrl, WFM_ITEMS_URL } from './lib/sources.mjs';

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

/** @param {import('./lib/sources.mjs').Items} items */
const writeItems = (items) => JSON.stringify(Object.fromEntries([...items].sort(([a], [b]) => a.localeCompare(b)).map(([id, item]) => [id, [item.path, item.slug]])));

/** @param {string | undefined} text @returns {import('./lib/sources.mjs').Items | undefined} */
function readItems(text) {
  if (!text) return undefined;
  /** @type {import('./lib/sources.mjs').Items} */
  const items = new Map();
  for (const [id, value] of Object.entries(JSON.parse(text))) {
    if (Array.isArray(value) && typeof value[0] === 'string' && typeof value[1] === 'string') items.set(id, { path: value[0], slug: value[1] });
  }
  return items.size > 0 ? items : undefined;
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
  const days = new Map();
  for (const name of await files.list('days')) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
    const text = await files.read(`days/${name}`);
    const day = text ? readDay(text) : undefined;
    if (day && `${day.day}.json` === name) days.set(day.day, day);
  }
  const previousText = await files.read('v1/prices.json');
  const previous = previousText ? readPriceFile(previousText) : undefined;
  let items = readItems(await files.read('items.json'));
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
  for (const day of [...days.keys()]) {
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
  try {
    const result = await run({
      fetchText: fetchWithAgent,
      files: folderFiles(process.env['DATA_DIR'] ?? 'prices'),
      now: Date.now(),
      log: (text) => console.log(text),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      fallback: fallback === 'off' || fallback === 'full' ? fallback : 'prime',
      rebuild: ['1', 'true'].includes(process.env['REBUILD'] ?? ''),
    });
    // Warnungen als Anmerkung im Actions-Tab; der Workflow lässt den Lauf danach scheitern, damit GitHub eine Mail schickt.
    for (const warning of result.warnings) console.log(`::warning::${warning}`);
    if (process.env['GITHUB_OUTPUT']) await writeFile(process.env['GITHUB_OUTPUT'], `stale=${result.warnings.length > 0}\nasOf=${result.asOf}\n`, { flag: 'a' });
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
