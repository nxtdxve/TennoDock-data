// @ts-check
// Baut die Namen der Events für TennoDock (#188) im öffentlichen Daten-Repo: `events/v1/names.json` mit dem Namen jedes
// Events pro Sprachschlüssel (`Goals[].Desc` im worldState), Englisch und, wo es anders lautet, Deutsch. Läuft in der
// GitHub Action (Workflow `events.yml`), von Hand mit:
//
//   node events-file/build.mjs   Sprachdateien und worldState holen, Datei schreiben, wenn sich etwas geändert hat
//
// Im TennoDock-Repo liegt das Daten-Repo 1:1 unter `tools/tennodock-data/`; dort aufrufen.
//
// Quellen: WFCD `warframe-worldstate-data` (MIT), `data/languages.json` und `data/de/languages.json`, je rund 95 KB gzip;
// dazu der öffentliche worldState von Digital Extremes (`api.warframe.com`, derselbe Host wie die App), damit auch ein neues
// Event mit ungewohntem Schlüssel seinen Namen bekommt. Drei Abrufe pro Lauf. Keine Abhängigkeiten ausser Node (ab 20).
// Doku: docs/pakete/188-operations.md im App-Repo.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildNames, isRecord, previousNames, readLanguages, runningKeys } from './lib/event-names.mjs';

const WFCD = 'https://raw.githubusercontent.com/WFCD/warframe-worldstate-data/master/data';
export const EN_URL = `${WFCD}/languages.json`;
export const DE_URL = `${WFCD}/de/languages.json`;
export const WORLDSTATE_URL = 'https://api.warframe.com/cdn/worldState.php';
export const SOURCE = 'github.com/WFCD/warframe-worldstate-data';
export const LICENSE = 'MIT';
export const FILE = 'v1/names.json';
const FORMAT = 'tennodock-event-names';
const VERSION = 1;
const USER_AGENT = 'TennoDock-data/1 (+https://github.com/nxtdxve/TennoDock-data; event names)';
/** Plausibel ist eine Sprachdatei mit so vielen Einträgen; weniger heisst, ihre Form hat sich geändert. */
const MIN_LANGUAGE_ENTRIES = 1000;
/** Plausibel ist ein Stand mit mindestens so vielen Namen. */
const MIN_NAMES = 5;

/**
 * @typedef {import('./lib/event-names.mjs').NameTable} NameTable
 * @typedef {{ status: number, text: string }} Response
 * @typedef {(url: string) => Promise<Response>} FetchText Wirft, wenn keine Antwort kommt.
 * @typedef {{ read(path: string): Promise<string | undefined>, write(path: string, text: string): Promise<void> }} Files
 *   Dateien relativ zum Datenordner (`events/`).
 * @typedef {{ format: string, v: number, asOf: string, generatedAt: string, source: string, license: string, names: NameTable }} NamesFile
 * @typedef {{ fetchText: FetchText, files: Files, now: number, log(text: string): void, minEntries?: number, minNames?: number }} RunDeps
 *   `minEntries`, `minNames`: Untergrenzen der Prüfung (Tests mit kleinen Beispielen).
 * @typedef {{ written: boolean, asOf: string, names: number }} RunResult
 */

/** @param {string} text */
function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * JSON von einer Adresse; wirft bei einem Fehler.
 * @param {FetchText} fetchText @param {string} url @returns {Promise<unknown>}
 */
async function fetchJson(fetchText, url) {
  const response = await fetchText(url);
  if (response.status !== 200) throw new Error(`HTTP ${response.status} for ${url}`);
  const json = parse(response.text);
  if (json === undefined) throw new Error(`Not JSON: ${url}`);
  return json;
}

/** Inhalt ohne Zeit des Laufs und ohne Stand, zum Vergleich. @param {NamesFile} file */
const content = ({ generatedAt: _generatedAt, asOf: _asOf, ...rest }) => JSON.stringify(rest);

/**
 * Bisherige Datei, wenn sie lesbar ist.
 * @param {string | undefined} text @returns {NamesFile | undefined}
 */
export function readNamesFile(text) {
  const value = text === undefined ? undefined : parse(text);
  if (!isRecord(value) || value['format'] !== FORMAT || value['v'] !== VERSION) return undefined;
  return /** @type {NamesFile} */ ({ ...value, names: previousNames(value) });
}

/**
 * Datei aus der Tabelle; `asOf` ist der Tag des Laufs, an dem sich etwas geändert hat.
 * @param {NameTable} names @param {number} now @returns {NamesFile}
 */
export function buildFile(names, now) {
  const iso = new Date(now).toISOString();
  return { format: FORMAT, v: VERSION, asOf: iso.slice(0, 10), generatedAt: iso.replace(/\.\d{3}Z$/, 'Z'), source: SOURCE, license: LICENSE, names };
}

/** @param {RunDeps} deps @returns {Promise<RunResult>} */
export async function run(deps) {
  const { files, log, fetchText } = deps;
  const minEntries = deps.minEntries ?? MIN_LANGUAGE_ENTRIES;
  const en = readLanguages(await fetchJson(fetchText, EN_URL));
  const de = readLanguages(await fetchJson(fetchText, DE_URL));
  if (en.size < minEntries) throw new Error(`Only ${en.size} English entries; check the form of ${EN_URL}`);
  // Der worldState ist eine Ergänzung: Ohne ihn gelten die Muster der Schlüssel (`isEventKey`) und der bisherige Stand.
  let running = /** @type {string[]} */ ([]);
  try {
    running = runningKeys(await fetchJson(fetchText, WORLDSTATE_URL));
  } catch (error) {
    log(`World state not read (${error instanceof Error ? error.message : String(error)}); continuing without it`);
  }
  const previous = readNamesFile(await files.read(FILE));
  const names = buildNames({ en, de, previous: previous?.names ?? {}, running });
  const count = Object.keys(names).length;
  if (count < (deps.minNames ?? MIN_NAMES)) throw new Error(`Only ${count} event names; not written`);
  const missing = running.filter((key) => !names[key]);
  if (missing.length > 0) log(`${missing.length} running event(s) without a name in the source yet`);
  const file = buildFile(names, deps.now);
  // Ohne Änderung bleibt die Datei, wie sie ist (kein Commit, kein neuer ETag, kein neuer Download in der App).
  if (previous && content(previous) === content(file)) {
    log(`Event names up to date (${count} names, as of ${previous.asOf})`);
    return { written: false, asOf: previous.asOf, names: count };
  }
  await files.write(FILE, `${JSON.stringify(file)}\n`);
  log(`Written: ${FILE} (${count} names)`);
  return { written: true, asOf: file.asOf, names: count };
}

/**
 * Ausgaben des Schritts für `GITHUB_OUTPUT` (Commit-Meldung), streng geprüft; der Workflow übergibt sie nur über `env:`.
 * @param {RunResult} result @returns {string}
 */
export function outputLines(result) {
  const { asOf, names } = result;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isSafeInteger(names) || names < 0) throw new Error('Unexpected values for the step outputs');
  return `asOf=${asOf}\nnames=${names}\n`;
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

/** Abruf mit eigener Kennung und Frist. @type {FetchText} */
export async function fetchWithAgent(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60 * 1000) });
  return { status: response.status, text: await response.text() };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const output = process.env['GITHUB_OUTPUT'];
  try {
    const result = await run({ fetchText: fetchWithAgent, files: folderFiles(process.env['DATA_DIR'] ?? 'events'), now: Date.now(), log: (text) => console.log(text) });
    if (output) await writeFile(output, outputLines(result), { flag: 'a' });
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
