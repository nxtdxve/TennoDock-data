// @ts-check
// Baut die Datei der eingebauten Polaritäten (#144) im öffentlichen Daten-Repo: `polarities/v1/polarities.json` mit den
// Polaritäten der Mod-Plätze (ohne Platz), der Aura, des Exilus und der Haltung pro Item. Läuft in der GitHub Action
// (Workflow `polarities.yml`), von Hand mit:
//
//   node polarity-file/build.mjs              neuen Stand von WFCD/warframe-items holen, Datei bauen, falls neu
//   REBUILD=1 node polarity-file/build.mjs    auch ohne neuen Stand neu bauen (z. B. nach einer Änderung am Skript)
//
// Im TennoDock-Repo liegt das Daten-Repo 1:1 unter `tools/tennodock-data/`; dort aufrufen.
//
// Quelle: WFCD/warframe-items (MIT-Lizenz), Werte aus dem WARFRAME Wiki. Weder DE noch public-export-plus nennen
// Polaritäten. Der Platz der Polaritäten auf den Mod-Plätzen steht in keiner offenen Quelle; die App zeigt sie darum als
// Liste. Abgerufen werden der neueste Commit über api.github.com und `data/json/<Datei>.json` dieses Commits über
// raw.githubusercontent.com. Keine Abhängigkeiten ausser Node (ab 20). Doku: docs/pakete/144-modcard-hover.md im App-Repo.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { polarityTable, SOURCE_FILES } from './lib/polarities.mjs';

export const SOURCE = 'WFCD/warframe-items';
const BRANCH = 'master';
export const COMMIT_URL = `https://api.github.com/repos/${SOURCE}/commits/${BRANCH}`;
/** @param {string} sha @param {string} file */
export const rawUrl = (sha, file) => `https://raw.githubusercontent.com/${SOURCE}/${sha}/data/json/${file}.json`;
export const OUTPUT = 'polarities/v1/polarities.json';
const USER_AGENT = 'TennoDock-data/1 (+https://github.com/nxtdxve/TennoDock-data)';
const FORMAT = 'tennodock-polarities';
const VERSION = 1;
/** Plausibel: genug Items und nicht viel weniger als bisher. */
const MIN_ITEMS = 400;
const MIN_SHARE_OF_PREVIOUS = 0.8;

/**
 * @typedef {{ status: number, text: string }} Response
 * @typedef {(url: string) => Promise<Response>} FetchText Wirft, wenn keine Antwort kommt.
 * @typedef {{ read(path: string): Promise<string | undefined>, write(path: string, text: string): Promise<void> }} Files
 * @typedef {import('./lib/polarities.mjs').Entry} Entry
 * @typedef {{ format: string, v: number, asOf: string, generatedAt: string, source: string, commit: string, license: string, items: Record<string, Entry> }} PolarityFile
 * @typedef {{ fetchText: FetchText, files: Files, now: number, log(text: string): void, rebuild?: boolean, minItems?: number }} RunDeps
 * @typedef {{ written: boolean, commit?: string, asOf?: string, items?: number }} RunResult
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
 * Holt den Stand, baut die Tabelle und schreibt die Datei, wenn sich etwas geändert hat.
 * @param {RunDeps} deps
 * @returns {Promise<RunResult>}
 */
export async function run({ fetchText, files, now, log, rebuild = false, minItems = MIN_ITEMS }) {
  const head = await fetchText(COMMIT_URL);
  if (head.status !== 200) throw new Error(`Commit: HTTP ${head.status}`);
  const commit = parse(head.text)?.sha;
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) throw new Error('Commit: no sha');
  const previous = /** @type {PolarityFile | undefined} */ (parse((await files.read(OUTPUT)) ?? ''));
  if (!rebuild && previous?.commit === commit) {
    log(`No new commit (${commit.slice(0, 7)})`);
    return { written: false, commit };
  }
  /** @type {unknown[][]} */
  const lists = [];
  for (const file of SOURCE_FILES) {
    const response = await fetchText(rawUrl(commit, file));
    if (response.status !== 200) throw new Error(`${file}: HTTP ${response.status}`);
    const list = parse(response.text);
    if (!Array.isArray(list)) throw new Error(`${file}: not a list`);
    lists.push(list);
  }
  const items = polarityTable(lists);
  const count = Object.keys(items).length;
  const before = previous ? Object.keys(previous.items ?? {}).length : 0;
  if (count < minItems || count < before * MIN_SHARE_OF_PREVIOUS) throw new Error(`Implausible: ${count} items (before ${before})`);
  // Gleicher Inhalt: nichts schreiben, auch wenn die Quelle einen neuen Commit hat.
  if (previous && JSON.stringify(previous.items) === JSON.stringify(items)) {
    log(`Unchanged content (${count} items, ${commit.slice(0, 7)})`);
    return { written: false, commit };
  }
  const asOf = new Date(now).toISOString().slice(0, 10);
  /** @type {PolarityFile} */
  const file = { format: FORMAT, v: VERSION, asOf, generatedAt: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z'), source: SOURCE, commit, license: 'MIT', items };
  await files.write(OUTPUT, `${JSON.stringify(file)}\n`);
  log(`Wrote ${OUTPUT}: ${count} items (${commit.slice(0, 7)})`);
  return { written: true, commit, asOf, items: count };
}

/** @returns {FetchText} */
function nodeFetch() {
  const token = process.env['GITHUB_TOKEN'];
  return async (url) => {
    /** @type {Record<string, string>} */
    const headers = { 'User-Agent': USER_AGENT };
    if (token && url.startsWith('https://api.github.com/')) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(url, { headers });
    return { status: response.status, text: await response.text() };
  };
}

/** @param {string} root @returns {Files} */
function diskFiles(root) {
  return {
    read: async (path) => {
      try {
        return await readFile(join(root, path), 'utf8');
      } catch {
        return undefined;
      }
    },
    write: async (path, text) => {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await run({ fetchText: nodeFetch(), files: diskFiles(process.cwd()), now: Date.now(), log: (text) => console.log(text), rebuild: process.env['REBUILD'] === '1' || process.env['REBUILD'] === 'true' });
  // Für den Workflow (Commit-Nachricht).
  const out = process.env['GITHUB_OUTPUT'];
  if (out && result.written) await writeFile(out, `commit=${(result.commit ?? '').slice(0, 7)}\nasOf=${result.asOf}\n`, { flag: 'a' });
}
