// @ts-check
// Baut die Fundorte aus dem WARFRAME Wiki für TennoDock (#164) im öffentlichen Daten-Repo:
//
//   sources/v1/collectibles.json  Ort pro Lore-Fragment, Somachord-Lied und Frame-Fighter-Fragment (Modul Collectibles)
//   sources/v1/items.json         Fundort pro Item (Captura, Sigils, Syandanas, Ephemeras) und Namen von Händlern
//   sources/v1/missing.json       Items dieser Arten ohne Eintrag („Fundort fehlt“), mit dem Tag, seit dem sie fehlen
//
// Läuft in der GitHub Action (Workflow `sources.yml`), einmal pro Woche; von Hand: `node sources-file/build.mjs`.
// Im TennoDock-Repo liegt das Daten-Repo 1:1 unter `tools/tennodock-data/`; dort aufrufen.
//
// Quellen:
//   - WARFRAME Wiki (wiki.warframe.com), Lizenz CC BY-NC-SA 3.0: alle Seiten in einem Abruf der MediaWiki-API (`PAGES`).
//     Abschaltbar: `SOURCES_WIKI=off` (im Workflow eine Zeile). Dann bleiben `collectibles.json` und `items.json` stehen,
//     `missing.json` wird weiter gegen den DE-Export geprüft.
//   - DE-Export (content.warframe.com): Pfade und englische Namen; Rückfall public-export-plus.
//   - public-export-plus (GitHub, MIT): `ExportCodex` (Listen der Fragmente), `dict.en` (deren Namen), `ExportVendors`;
//     für missing.json auch `ExportCustoms`, `ExportResources`, `ExportBundles` und `ExportSyndicates`: Was die App ohne
//     Wiki zuordnet (Markt, Händler, Syndikate, Regeln, `lib/covered.mjs`), fehlt nicht.
// Keine Abhängigkeiten ausser Node (ab 22) und `xz` (auf GitHub-Runnern vorhanden). Doku: docs/pakete/164-sources.md im App-Repo.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DE_FILE_BASE, fetchIndex, parseDeJson, parseIndex, PLUS_BASE, unlzmaWithXz } from '../promo-codes-file/lib/names.mjs';
import { DE_FILES, deItems, PLUS_DICT, PLUS_FILES, plusItems } from '../promo-codes-file/lib/rewards.mjs';
import { appSource, gameSources } from './lib/covered.mjs';
import { CATEGORIES, capturaSources, codexNames, fighterNames, fighterPlaces, fragmentPlaces, missingIn, missingReport, prexPlaces, sigilPageSources, sigilSources, songSources, tableSources, vendorNames } from './lib/sources.mjs';

export const SOURCE = 'wiki.warframe.com';
export const LICENSE = 'CC BY-NC-SA 3.0';
/** Seiten, alle in einem Abruf (die API nimmt bis zu 50 Titel). */
export const FRAGMENT_PAGES = ['Cephalon', 'Fish', 'Glass', 'Ghoul', 'Revenant', 'Solaris United', 'Partnership', 'The Tenets', 'Duviri', 'Albrecht', 'Isleweaver'].map((set) => `Fragments/${set}`);
// #164 Nacharbeit: `Sigils` (Sätze zu Sigils ohne Fundort im Modul) und `Decorations/Orbiter Decorations` (Prex-Karten),
// weiter in demselben Abruf.
export const PAGES = [...FRAGMENT_PAGES, 'Somachord/Tones', 'Frame Fighter', 'Captura', 'Syandana', 'Ephemera', 'Module:Sigils/data', 'Module:Vendors/data', 'Sigils', 'Decorations/Orbiter Decorations'];
const PREX_PAGE = 'Decorations/Orbiter Decorations';
/** Dateien von public-export-plus für die Regeln der App (`lib/covered.mjs`), mit ihrem Schlüssel in `GameData`. */
const RULE_FILES = /** @type {const} */ ({ customs: 'ExportCustoms', resources: 'ExportResources', bundles: 'ExportBundles', syndicates: 'ExportSyndicates' });
const RULE_KEYS = /** @type {(keyof typeof RULE_FILES)[]} */ (Object.keys(RULE_FILES));
export const FILES = { collectibles: 'v1/collectibles.json', items: 'v1/items.json', missing: 'v1/missing.json' };
const API = 'https://wiki.warframe.com/api.php';
// Mit Kontakt, wie es die Wiki-Betreiber erwarten: Projekt und Repo, keine E-Mail.
const USER_AGENT = 'TennoDock-data/1 (+https://github.com/nxtdxve/TennoDock-data; weekly list of item sources)';
const FORMAT = { collectibles: 'tennodock-sources-collectibles', items: 'tennodock-sources-items', missing: 'tennodock-sources-missing' };
const VERSION = 1;
/**
 * Untergrenzen der Prüfung; ein Abschnitt darf auch nicht unter die Hälfte des bisherigen fallen. `game`: so viele Items muss
 * der Spiel-Export mindestens liefern, sonst bleibt missing.json stehen (rund 14'500 im November 2026). `customs` bis
 * `syndicates`: Einträge der Regel-Dateien von plus (im November 2026 4'766, 3'524, 1'164 und 40); fehlt eine oder hat sie
 * weniger, bleibt missing.json ebenfalls stehen (Review K5).
 */
export const MINIMUM = { fragments: 100, songs: 50, fighters: 30, items: 400, game: 5000, customs: 2000, resources: 1500, bundles: 500, syndicates: 20 };
const MIN_SHARE_OF_PREVIOUS = 0.5;
const ATTEMPTS = 3;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * @typedef {import('./lib/sources.mjs').Source} Source
 * @typedef {import('./lib/sources.mjs').SongSource} SongSource
 * @typedef {import('./lib/sources.mjs').NamedPath} NamedPath
 * @typedef {import('./lib/sources.mjs').MissingCategory} MissingCategory
 * @typedef {{ status: number, text: string, retryAfter?: number }} Response
 * @typedef {{ read(path: string): Promise<string | undefined>, write(path: string, text: string): Promise<void> }} Files
 * @typedef {{ pages: Record<string, string>, revisedAt: string }} WikiPages
 * @typedef {{ items: NamedPath[], names: Map<string, string>, codex: unknown, dict: unknown, vendors: unknown, source: 'de' | 'plus', customs?: unknown, resources?: unknown, bundles?: unknown, syndicates?: unknown }} GameData
 *   `customs` bis `syndicates`: Dateien von public-export-plus für die Regeln der App (`lib/covered.mjs`); fehlt eine oder ist sie
 *   fast leer (`MINIMUM`), bleibt missing.json stehen.
 * @typedef {{ format: string, v: number, asOf: string, generatedAt: string, source: string, license: string, fragments: Record<string, string>, songs: Record<string, SongSource>, fighters: Record<string, string> }} CollectiblesFile
 * @typedef {{ format: string, v: number, asOf: string, generatedAt: string, source: string, license: string, items: Record<string, Source[]>, vendors: Record<string, string> }} ItemsFile
 * @typedef {{ format: string, v: number, asOf: string, generatedAt: string, categories: Record<string, MissingCategory> }} MissingFile
 * @typedef {{
 *   fetchText(url: string): Promise<Response>,
 *   loadGame(): Promise<GameData>,
 *   files: Files,
 *   now: number,
 *   log(text: string): void,
 *   wiki?: boolean,
 *   minimum?: Partial<typeof MINIMUM>,
 *   sleep?(ms: number): Promise<void>,
 * }} RunDeps `wiki: false` fragt das Wiki nicht ab (Schalter). `minimum`: kleinere Grenzen für Tests.
 * @typedef {{ written: string[], asOf: string, places: number, items: number, missing: number, unmatched: number }} RunResult
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
const day = (/** @type {number} */ now) => new Date(now).toISOString().slice(0, 10);
const stamp = (/** @type {number} */ now) => new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Adresse des Abrufs aller Seiten; `continued` aus der vorigen Antwort, falls die API teilt. @param {Record<string, string>} [continued] */
export function apiUrl(continued = {}) {
  const params = { action: 'query', prop: 'revisions', rvprop: 'ids|content|timestamp', rvslots: 'main', titles: PAGES.join('|'), format: 'json', formatversion: '2', maxlag: '5', ...continued };
  return `${API}?${new URLSearchParams(params)}`;
}

/**
 * Inhalt und Zeit der Seiten aus einer Antwort (`formatversion=2`); fehlende Seiten fallen weg.
 * @param {unknown} json @returns {{ pages: Record<string, string>, times: string[], continued?: Record<string, string> }}
 */
export function readPages(json) {
  const query = isRecord(json) ? json['query'] : undefined;
  const list = isRecord(query) && Array.isArray(query['pages']) ? query['pages'] : [];
  /** @type {Record<string, string>} */
  const pages = {};
  /** @type {string[]} */
  const times = [];
  for (const page of list) {
    const revision = isRecord(page) && Array.isArray(page['revisions']) ? page['revisions'][0] : undefined;
    const slots = isRecord(revision) ? revision['slots'] : undefined;
    const main = isRecord(slots) ? slots['main'] : undefined;
    const text = isRecord(main) ? main['content'] : undefined;
    if (!isRecord(page) || typeof page['title'] !== 'string' || typeof text !== 'string') continue;
    pages[page['title']] = text;
    if (isRecord(revision) && typeof revision['timestamp'] === 'string' && ISO_TIME.test(revision['timestamp'])) times.push(revision['timestamp']);
  }
  const next = isRecord(json) ? json['continue'] : undefined;
  const continued = isRecord(next) ? Object.fromEntries(Object.entries(next).filter((entry) => typeof entry[1] === 'string')) : undefined;
  return continued && Object.keys(continued).length > 0 ? { pages, times, continued: /** @type {Record<string, string>} */ (continued) } : { pages, times };
}

/**
 * Alle Seiten; bei 429, 5xx und `maxlag` bis zu dreimal mit Pause. Teilt die API die Antwort (`continue`), folgen höchstens
 * fünf weitere Abrufe.
 * @param {RunDeps} deps @returns {Promise<WikiPages>}
 */
export async function fetchPages(deps) {
  const sleep = deps.sleep ?? ((/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms)));
  /** @type {Record<string, string>} */
  const pages = {};
  /** @type {string[]} */
  const times = [];
  /** @type {Record<string, string> | undefined} */
  let continued = {};
  for (let round = 0; continued && round < 6; round++) {
    const url = apiUrl(continued);
    let json;
    for (let attempt = 1; ; attempt++) {
      const response = await deps.fetchText(url);
      json = response.status === 200 ? parse(response.text) : undefined;
      const error = isRecord(json) && isRecord(json['error']) ? String(json['error']['code']) : undefined;
      const busy = response.status === 429 || response.status >= 500 || error === 'maxlag';
      if (busy && attempt < ATTEMPTS) {
        await sleep(response.retryAfter ? response.retryAfter * 1000 : 10_000 * attempt);
        continue;
      }
      if (response.status !== 200) throw new Error(`HTTP ${response.status} from the wiki`);
      if (json === undefined) throw new Error('Wiki answer is not JSON');
      if (error) throw new Error(`Wiki API error: ${error}`);
      break;
    }
    const read = readPages(json);
    for (const [title, text] of Object.entries(read.pages)) pages[title] ??= text;
    times.push(...read.times);
    continued = read.continued;
  }
  const missing = PAGES.filter((title) => !(title in pages));
  if (missing.length > 0) deps.log(`::warning::Wiki pages missing: ${missing.join(', ')}`);
  const revisedAt = times.sort().at(-1);
  if (!revisedAt) throw new Error('No wiki page in the answer');
  return { pages, revisedAt };
}

/**
 * Beide Dateien aus den Seiten und den Spieldaten.
 * @param {WikiPages} wiki @param {GameData} game @param {number} now
 * @returns {{ collectibles: CollectiblesFile, items: ItemsFile, unmatched: Record<string, string[]> }}
 */
export function buildFiles(wiki, game, now) {
  const { pages } = wiki;
  const codex = isRecord(game.codex) ? game.codex : {};
  const loreFragments = codexNames(codex['loreFragments'], game.dict);
  const fragments = fragmentPlaces(pages, loreFragments);
  const prex = prexPlaces(pages[PREX_PAGE] ?? '', loreFragments);
  for (const [path, place] of Object.entries(prex.found)) fragments.found[path] ??= place;
  const songs = songSources(pages['Somachord/Tones'] ?? '', codexNames(codex['songs'], game.dict));
  const fighters = fighterPlaces(pages['Frame Fighter'] ?? '', fighterNames(codex['fighterFrames'], game.names));
  const captura = capturaSources(pages['Captura'] ?? '', game.items);
  const syandanas = tableSources(pages['Syandana'] ?? '', game.items, CATEGORIES.syandanas);
  const ephemeras = tableSources(pages['Ephemera'] ?? '', game.items, CATEGORIES.ephemeras);
  const sigils = sigilSources(pages['Module:Sigils/data'] ?? '', game.items);
  // Die Seite füllt nur Lücken des Moduls (#164 Nacharbeit).
  const sigilPage = sigilPageSources(pages['Sigils'] ?? '', game.items);
  const head = { asOf: wiki.revisedAt.slice(0, 10), generatedAt: stamp(now), source: SOURCE, license: LICENSE };
  /** @type {Record<string, Source[]>} */
  const items = {};
  for (const part of [captura, syandanas, ephemeras, sigils, sigilPage]) for (const [path, sources] of Object.entries(part.found)) items[path] ??= sources;
  return {
    collectibles: { format: FORMAT.collectibles, v: VERSION, ...head, fragments: sortKeys(fragments.found), songs: sortKeys(songs.found), fighters: sortKeys(fighters.found) },
    items: { format: FORMAT.items, v: VERSION, ...head, items: sortKeys(items), vendors: sortKeys(vendorNames(pages['Module:Vendors/data'] ?? '', game.vendors, game.names)) },
    unmatched: { fragments: fragments.unmatched, prex: prex.unmatched, songs: songs.unmatched, fighters: fighters.unmatched, captura: captura.unmatched, syandanas: syandanas.unmatched, ephemeras: ephemeras.unmatched, sigils: sigils.unmatched },
  };
}

/** @template T @param {Record<string, T>} record @returns {Record<string, T>} */
function sortKeys(record) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * „Fundort fehlt“: alle Items der abgedeckten Arten (DE-Export) und alle Fragmente, Lieder und Frame-Fighter-Fragmente
 * (public-export-plus) ohne Eintrag in den beiden Dateien. Seit #164 (Nacharbeit) fehlt auch nicht, was die App ohne Wiki
 * zuordnet (`lib/covered.mjs`): Markt, Händler, Syndikate, Regeln, am PC nicht erhältlich.
 * @param {GameData} game @param {CollectiblesFile | undefined} collectibles @param {ItemsFile | undefined} items
 * @param {MissingFile | undefined} previous @param {number} now @returns {MissingFile}
 */
export function buildMissing(game, collectibles, items, previous, now) {
  const today = day(now);
  const codex = isRecord(game.codex) ? game.codex : {};
  const covered = new Set([...Object.keys(items?.items ?? {}), ...Object.keys(collectibles?.fragments ?? {}), ...Object.keys(collectibles?.songs ?? {}), ...Object.keys(collectibles?.fighters ?? {})]);
  const known = gameSources(game);
  /** @type {Record<string, NamedPath[]>} */
  const lists = {
    fragments: codexNames(codex['loreFragments'], game.dict),
    songs: codexNames(codex['songs'], game.dict),
    fighters: codexNames(codex['fighterFrames'], game.dict),
  };
  for (const [category, prefixes] of Object.entries(CATEGORIES)) {
    lists[category] = game.items.filter((item) => prefixes.some((prefix) => prefix.test(item.path)));
    for (const { path, name } of lists[category]) if (appSource(path, known, name)) covered.add(path);
  }
  /** @type {Record<string, MissingCategory>} */
  const categories = {};
  for (const [category, list] of Object.entries(lists)) categories[category] = missingIn(list, covered, previous?.categories[category]?.missing, today);
  return { format: FORMAT.missing, v: VERSION, asOf: today, generatedAt: stamp(now), categories };
}

/** Bisherige Datei, wenn Format und Version passen. @template T @param {string | undefined} text @param {string} format @returns {T | undefined} */
function readFile2(text, format) {
  const value = text === undefined ? undefined : parse(text);
  return isRecord(value) && value['format'] === format && value['v'] === VERSION ? /** @type {T} */ (value) : undefined;
}

/** Inhalt ohne Zeit des Laufs und Tag, zum Vergleich. @param {object} file */
const content = (file) => JSON.stringify({ ...file, generatedAt: undefined, asOf: undefined });

/** Ein Abschnitt darf nicht einbrechen. @param {string} label @param {number} count @param {number | undefined} before @param {number} minimum */
function check(label, count, before, minimum) {
  if (count < minimum) throw new Error(`Only ${count} ${label} read; check the form of the wiki pages`);
  if (before !== undefined && count < before * MIN_SHARE_OF_PREVIOUS) throw new Error(`Sources not written: ${count} ${label}, before ${before}`);
}

/** @param {RunDeps} deps @returns {Promise<RunResult>} */
export async function run(deps) {
  const { files, log, now } = deps;
  const game = await deps.loadGame();
  log(`Game data: ${game.items.length} named items (${game.source})`);
  const minimum = { ...MINIMUM, ...deps.minimum };
  /** @type {string[]} */
  const written = [];
  let collectibles = readFile2(/** @type {string | undefined} */ (await files.read(FILES.collectibles)), FORMAT.collectibles);
  let items = readFile2(/** @type {string | undefined} */ (await files.read(FILES.items)), FORMAT.items);
  let unmatched = 0;
  if (deps.wiki === false) {
    log('Wiki switched off (SOURCES_WIKI=off): collectibles.json and items.json stay as they are');
  } else {
    const wiki = await fetchPages(deps);
    const built = buildFiles(wiki, game, now);
    const c = /** @type {CollectiblesFile | undefined} */ (collectibles);
    const i = /** @type {ItemsFile | undefined} */ (items);
    check('fragment places', Object.keys(built.collectibles.fragments).length, c ? Object.keys(c.fragments).length : undefined, minimum.fragments);
    check('songs', Object.keys(built.collectibles.songs).length, c ? Object.keys(c.songs).length : undefined, minimum.songs);
    check('frame fighters', Object.keys(built.collectibles.fighters).length, c ? Object.keys(c.fighters).length : undefined, minimum.fighters);
    check('item sources', Object.keys(built.items.items).length, i ? Object.keys(i.items).length : undefined, minimum.items);
    for (const [part, names] of Object.entries(built.unmatched)) if (names.length > 0) log(`Not matched (${part}, ${names.length}): ${names.slice(0, 20).join(', ')}${names.length > 20 ? ', …' : ''}`);
    unmatched = Object.values(built.unmatched).reduce((sum, names) => sum + names.length, 0);
    if (!c || content(c) !== content(built.collectibles)) {
      await files.write(FILES.collectibles, `${JSON.stringify(built.collectibles)}\n`);
      written.push(FILES.collectibles);
    }
    if (!i || content(i) !== content(built.items)) {
      await files.write(FILES.items, `${JSON.stringify(built.items)}\n`);
      written.push(FILES.items);
    }
    collectibles = built.collectibles;
    items = built.items;
  }
  const c = /** @type {CollectiblesFile | undefined} */ (collectibles);
  const i = /** @type {ItemsFile | undefined} */ (items);
  const previous = /** @type {MissingFile | undefined} */ (readFile2(/** @type {string | undefined} */ (await files.read(FILES.missing)), FORMAT.missing));
  // Ist die Grundlage leer oder kaputt (Spiel-Export ohne Items, Review K9) oder fehlt eine Regel-Datei bzw. ist sie fast
  // leer (Review K5), bleibt missing.json, wie es ist: Sonst stünde dort, was die App längst kennt.
  const short = RULE_KEYS.filter((key) => Object.keys(isRecord(game[key]) ? game[key] : {}).length < minimum[key]);
  const usable = game.items.length >= minimum.game && short.length === 0;
  if (game.items.length < minimum.game) log(`::warning::Only ${game.items.length} game items; missing.json stays as it is`);
  for (const key of short) log(`::warning::Rule file ${key} has ${Object.keys(isRecord(game[key]) ? game[key] : {}).length} entries (minimum ${minimum[key]}); missing.json stays as it is`);
  const missing = usable ? buildMissing(game, c, i, previous, now) : previous;
  if (usable && missing && (!previous || content(previous) !== content(missing))) {
    await files.write(FILES.missing, `${JSON.stringify(missing, null, 1)}\n`);
    written.push(FILES.missing);
  }
  const places = c ? Object.keys(c.fragments).length + Object.keys(c.songs).length + Object.keys(c.fighters).length : 0;
  const count = Object.values(missing?.categories ?? {}).reduce((sum, category) => sum + category.missing.length, 0);
  log(`${written.length > 0 ? `Written: ${written.join(', ')}` : 'Sources up to date'} (${places} places, ${i ? Object.keys(i.items).length : 0} item sources, ${count} missing)`);
  return { written, asOf: c?.asOf ?? day(now), places, items: i ? Object.keys(i.items).length : 0, missing: count, unmatched };
}

/**
 * Ausgaben des Schritts für `GITHUB_OUTPUT` (Commit-Meldung), streng geprüft; der Workflow übergibt sie nur über `env:`.
 * @param {RunResult} result @returns {string}
 */
export function outputLines(result) {
  const { asOf, places, items, missing } = result;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || ![places, items, missing].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error('Unexpected values for the step outputs');
  return `asOf=${asOf}\nplaces=${places}\nitems=${items}\nmissing=${missing}\n`;
}

/** Dateien im Ordner `root`. @param {string} root @returns {Files} */
export function folderFiles(root) {
  return {
    read: (path) => readFile(join(root, path), 'utf8').catch(() => undefined),
    async write(path, text) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    },
  };
}

/** Abruf mit eigener Kennung und Frist. @param {string} url @returns {Promise<Response>} */
export async function fetchWithAgent(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(120 * 1000) });
  const retryAfter = Number(response.headers.get('retry-after') ?? 0);
  return { status: response.status, text: await response.text(), ...(retryAfter > 0 ? { retryAfter } : {}) };
}

/** @param {string} url */
async function get(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(180 * 1000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response;
}

/**
 * Spieldaten: Namen und Pfade aus dem DE-Export (Rückfall public-export-plus), dazu `ExportCodex`, `dict.en` und
 * `ExportVendors` von public-export-plus.
 * @param {(text: string) => void} log @returns {Promise<GameData>}
 */
export async function loadGameData(log) {
  const plus = async (/** @type {string} */ file) => JSON.parse(await (await get(`${PLUS_BASE}${file}.json`)).text());
  const [codex, dict, vendors] = await Promise.all(['ExportCodex', PLUS_DICT, 'ExportVendors'].map(plus));
  // Regeln der App für missing.json (#164 Nacharbeit): rund 7,8 MB mehr pro Lauf, nur in der Action. Einzeln: Fehlt eine,
  // laufen die Wiki-Dateien trotzdem; `run` lässt missing.json dann stehen (Review K5).
  const [customs, resources, bundles, syndicates] = await Promise.all(
    Object.values(RULE_FILES).map((file) =>
      plus(file).catch((/** @type {unknown} */ error) => {
        log(`::warning::${file} not available (${error instanceof Error ? error.message : String(error)}); missing.json stays as it is`);
        return undefined;
      }),
    ),
  );
  /** @type {NamedPath[]} */
  let items;
  /** @type {'de' | 'plus'} */
  let source = 'de';
  try {
    const index = parseIndex(await unlzmaWithXz(await fetchIndex(async (url) => new Uint8Array(await (await get(url)).arrayBuffer()), log)));
    const missing = DE_FILES.filter((file) => !index.has(file));
    if (missing.length > 0) throw new Error(`not in the index: ${missing.join(', ')}`);
    const exports = await Promise.all(DE_FILES.map(async (file) => parseDeJson(await (await get(`${DE_FILE_BASE}${index.get(file)}`)).text())));
    items = deItems(exports).filter((item) => !item.path.endsWith('Blueprint'));
  } catch (error) {
    log(`::warning::Public export not available (${error instanceof Error ? error.message : String(error)}); using public-export-plus`);
    items = plusItems(await Promise.all(PLUS_FILES.map(plus)), dict);
    source = 'plus';
  }
  const names = new Map(items.map((item) => [item.path, item.name]));
  return { items: items.map(({ path, name }) => ({ path, name })), names, codex, dict, vendors, source, customs, resources, bundles, syndicates };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const output = process.env['GITHUB_OUTPUT'];
  const log = (/** @type {string} */ text) => console.log(text);
  try {
    const result = await run({
      fetchText: fetchWithAgent,
      loadGame: () => loadGameData(log),
      files: folderFiles(process.env['DATA_DIR'] ?? 'sources'),
      now: Date.now(),
      log,
      wiki: process.env['SOURCES_WIKI'] !== 'off',
    });
    if (output) await writeFile(output, outputLines(result), { flag: 'a' });
    // Bericht für das Issue des Monats (nur wenn der Workflow einen Pfad und einen Stichtag setzt).
    const report = process.env['REPORT_FILE'];
    const from = process.env['REPORT_FROM'];
    if (report && from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
      const missing = parse((await readFile(join(process.env['DATA_DIR'] ?? 'sources', FILES.missing), 'utf8').catch(() => '')) ?? '');
      await writeFile(report, isRecord(missing) && isRecord(missing['categories']) ? missingReport(/** @type {Record<string, MissingCategory>} */ (missing['categories']), from) : '');
    }
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
