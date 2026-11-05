// @ts-check
// Baut die Liste der Creator-Glyphen-Codes (#122) im öffentlichen Daten-Repo: `glyph-codes/v1/codes.json` mit Code, Name
// und Bilddatei pro Glyphe, dazu Stand und Quelle. Läuft in der GitHub Action (Workflow `glyph-codes.yml`), von Hand mit:
//
//   node glyph-codes-file/build.mjs   Seite „Glyph“ im WARFRAME Wiki holen, Datei schreiben, wenn sich etwas geändert hat
//
// Im TennoDock-Repo liegt das Daten-Repo 1:1 unter `tools/tennodock-data/`; dort aufrufen.
//
// Quelle: WARFRAME Wiki (wiki.warframe.com), Seite „Glyph“, Abschnitt „Creator Glyphs“, Lizenz CC BY-NC-SA 3.0. Ein Abruf
// pro Lauf über die MediaWiki-API (ganze Seite, ohne Abschnittsnummer). Keine Abhängigkeiten ausser Node (ab 20).
// Doku: docs/pakete/122-glyph-codes.md im App-Repo.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CODE, IMAGE, parseGlyphCodes, wikiSection } from './lib/glyph-codes.mjs';

export const PAGE = 'Glyph';
export const HEADING = 'Creator Glyphs';
export const SOURCE = 'wiki.warframe.com';
export const PAGE_URL = 'https://wiki.warframe.com/w/Glyph#Creator_Glyphs';
export const LICENSE = 'CC BY-NC-SA 3.0';
export const API_URL = `https://wiki.warframe.com/api.php?${new URLSearchParams({ action: 'query', prop: 'revisions', rvprop: 'ids|content|timestamp', rvslots: 'main', titles: PAGE, format: 'json', formatversion: '2', maxlag: '5' })}`;
export const FILE = 'v1/codes.json';
// Mit Kontakt, wie es die User-Agent-Regeln der Wiki-Betreiber erwarten: Projekt und Repo, keine E-Mail.
const USER_AGENT = 'TennoDock-data/1 (+https://github.com/nxtdxve/TennoDock-data; weekly list of creator glyph codes)';
const FORMAT = 'tennodock-glyph-codes';
const VERSION = 1;
/** Plausibel ist ein Stand mit mindestens so vielen Codes und nicht weniger als der Hälfte des bisherigen. */
const MIN_CODES = 50;
const MIN_SHARE_OF_PREVIOUS = 0.5;
const ATTEMPTS = 3;

/**
 * @typedef {import('./lib/glyph-codes.mjs').GlyphCode} GlyphCode
 * @typedef {{ status: number, text: string, retryAfter?: number }} Response
 * @typedef {(url: string) => Promise<Response>} FetchText Wirft, wenn keine Antwort kommt.
 * @typedef {{ read(path: string): Promise<string | undefined>, write(path: string, text: string): Promise<void> }} Files
 *   Dateien relativ zum Datenordner (`glyph-codes/`).
 * @typedef {{ text: string, revision: number, revisedAt: string }} Revision
 * @typedef {{ format: string, v: number, asOf: string, revisedAt: string, generatedAt: string, source: string, page: string, revision: number, license: string, codes: GlyphCode[] }} GlyphCodesFile
 * @typedef {{ fetchText: FetchText, files: Files, now: number, log(text: string): void, minCodes?: number, sleep?(ms: number): Promise<void> }} RunDeps
 *   `minCodes`: Untergrenze der Prüfung (Tests mit kleinen Beispielen).
 * @typedef {{ written: boolean, asOf: string, revision: number, codes: number }} RunResult
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
/** @param {unknown} value @returns {unknown[] | undefined} */
const asArray = (value) => (Array.isArray(value) ? value : undefined);

/**
 * Quelltext, Nummer und Zeit der neuesten Fassung aus der Antwort der API (`formatversion=2`); `undefined`, wenn die Seite
 * fehlt oder die Form fremd ist.
 * @param {unknown} json @returns {Revision | undefined}
 */
export function readRevision(json) {
  const query = isRecord(json) ? json['query'] : undefined;
  const page = asArray(isRecord(query) ? query['pages'] : undefined)?.[0];
  const revision = asArray(isRecord(page) ? page['revisions'] : undefined)?.[0];
  if (!isRecord(revision)) return undefined;
  const slots = revision['slots'];
  const main = isRecord(slots) ? slots['main'] : undefined;
  const text = isRecord(main) ? main['content'] : undefined;
  const { revid, timestamp } = revision;
  return typeof text === 'string' && typeof revid === 'number' && typeof timestamp === 'string' ? { text, revision: revid, revisedAt: timestamp } : undefined;
}

/**
 * Datei aus einer Fassung der Seite. Wirft, wenn der Abschnitt fehlt oder kaum Codes hat (Form der Seite geändert).
 * @param {Revision} revision @param {number} now @returns {GlyphCodesFile}
 */
export function buildFile(revision, now, minCodes = MIN_CODES) {
  const section = wikiSection(revision.text, HEADING);
  if (section === undefined) throw new Error(`No section "${HEADING}" on the page ${PAGE}`);
  const codes = parseGlyphCodes(section);
  if (codes.length < minCodes) throw new Error(`Only ${codes.length} codes read; check the form of the page`);
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
    codes,
  };
}

/**
 * Bisherige Datei, wenn sie lesbar ist; Einträge, die keine Codes sein können, fallen weg.
 * @param {string | undefined} text @returns {GlyphCodesFile | undefined}
 */
export function readGlyphCodesFile(text) {
  const value = text === undefined ? undefined : parse(text);
  if (!isRecord(value) || value['format'] !== FORMAT || value['v'] !== VERSION || !Array.isArray(value['codes'])) return undefined;
  const codes = value['codes'].filter((entry) => isRecord(entry) && typeof entry['code'] === 'string' && CODE.test(entry['code']) && typeof entry['image'] === 'string' && IMAGE.test(entry['image']));
  return /** @type {GlyphCodesFile} */ ({ ...value, codes });
}

/** Inhalt ohne Zeit des Laufs, zum Vergleich. @param {GlyphCodesFile} file */
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
  const { files, log } = deps;
  const revision = readRevision(await fetchPage(deps));
  if (!revision) throw new Error(`No page ${PAGE} in the answer of the wiki`);
  const file = buildFile(revision, deps.now, deps.minCodes);
  const previous = readGlyphCodesFile(await files.read(FILE));
  const result = { asOf: file.asOf, revision: file.revision, codes: file.codes.length };
  // Ein Einbruch der Liste (Seite umgebaut oder beschädigt) ersetzt den bisherigen Stand nicht; die Action scheitert.
  if (previous && file.codes.length < previous.codes.length * MIN_SHARE_OF_PREVIOUS) {
    throw new Error(`Glyph codes not written: ${file.codes.length} codes, before ${previous.codes.length}`);
  }
  // Ohne Änderung bleibt die Datei, wie sie ist (kein Commit, kein neuer ETag, kein neuer Download in der App).
  if (previous && content(previous) === content(file)) {
    log(`Glyph codes up to date (revision ${file.revision}, ${file.revisedAt}, ${file.codes.length} codes)`);
    return { written: false, ...result };
  }
  await files.write(FILE, `${JSON.stringify(file)}\n`);
  log(`Written: ${FILE} (${file.codes.length} codes, revision ${file.revision} of ${file.revisedAt})`);
  return { written: true, ...result };
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
  const retryAfter = Number(response.headers.get('retry-after') ?? 0);
  return { status: response.status, text: await response.text(), ...(retryAfter > 0 ? { retryAfter } : {}) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const output = process.env['GITHUB_OUTPUT'];
  try {
    const result = await run({ fetchText: fetchWithAgent, files: folderFiles(process.env['DATA_DIR'] ?? 'glyph-codes'), now: Date.now(), log: (text) => console.log(text) });
    if (output) await writeFile(output, `asOf=${result.asOf}\nrevision=${result.revision}\ncodes=${result.codes}\n`, { flag: 'a' });
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
