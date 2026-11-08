// @ts-check
// Teile des DE Public Export für TennoDock (#179 Stufe 2): Namen pro Datei und Sprache (en, de), Mod-Texte, Katalog,
// Regionen, Paletten, Kosmetik, Bildpfade und Nightwave, abgeleitet mit denselben Funktionen wie die App (lib/derive.mjs).
//
//   node public-export-file/build.mjs     public-export/v1/manifest.json und die geänderten Teile unter parts/ schreiben
//
// Ablauf: Index `index_<Sprache>.txt.lzma` (0,5 KB, mit `xz` entpackt), zuerst von content.warframe.com, dann von
// origin.warframe.com (origin sperrt GitHub-Runner, gemessen 06.11.2026). Neu entstehen nur Teile, deren Index-Zeile oder
// Format sich geändert hat; jede DE-Datei kommt höchstens einmal, eine nach der anderen. Ohne Änderung kein Commit.
// Scheitert eine Datei, bleibt ihr bisheriger Teil im Manifest (die App merkt am Index, dass er alt ist, und lädt nach 6 h
// selbst von DE). TennoDock prüft jeden Teil per SHA-256. Keine Abhängigkeiten ausser Node (ab 22) und `xz`.
// Doku: docs/pakete/179-loading.md im App-Repo. Im TennoDock-Repo liegt der Ordner 1:1 unter `tools/tennodock-data/`.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { planTables } from './lib/derive.mjs';
import { buildManifest, derivePart, indexHash, LANGUAGES, parseDeJson, parseIndex, planWork, readManifest, staleFiles } from './lib/public-export.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public-export', 'v1');
const USER_AGENT = 'TennoDock-data/1 (+https://github.com/nxtdxve/TennoDock-data; public export parts)';
export const INDEX_URLS = (/** @type {string} */ language) => [`https://content.warframe.com/PublicExport/index_${language}.txt.lzma`, `https://origin.warframe.com/PublicExport/index_${language}.txt.lzma`];
export const FILE_BASE = 'https://content.warframe.com/PublicExport/Manifest/';

/**
 * @typedef {{
 *   fetchBytes(url: string): Promise<Uint8Array>,
 *   fetchText(url: string): Promise<string>,
 *   unlzma(bytes: Uint8Array): Promise<string>,
 *   now: string,
 *   log(text: string): void,
 *   rebuild?: boolean,
 * }} BuildOptions
 * @typedef {{ changed: boolean, index: string, parts: number, updated: string[], failed: string[] }} BuildResult
 */

/** Index einer Sprache von der ersten Adresse, die antwortet. @param {BuildOptions} options @param {string} language */
async function loadIndex(options, language) {
  /** @type {string[]} */
  const failures = [];
  for (const url of INDEX_URLS(language)) {
    try {
      const index = parseIndex(await options.unlzma(await options.fetchBytes(url)));
      if (failures.length > 0) options.log(`Index ${language} from ${new URL(url).host} (${failures.join('; ')})`);
      return index;
    } catch (error) {
      failures.push(`${new URL(url).host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`no index for ${language} (${failures.join('; ')})`);
}

/** Dateien unter `dir`, relativ und mit `/`. @param {string} dir @returns {Promise<string[]>} */
async function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => relative(dir, join(entry.parentPath, entry.name)).replace(/\\/g, '/'));
}

/**
 * Baut Manifest und Teile in `root` (Ordner `public-export/v1`).
 * @param {string} root @param {BuildOptions} options @returns {Promise<BuildResult>}
 */
export async function build(root, options) {
  const { log } = options;
  const manifestPath = join(root, 'manifest.json');
  const previous = existsSync(manifestPath) ? readManifest(JSON.parse(await readFile(manifestPath, 'utf8'))) : undefined;

  /** @type {Map<string, Map<string, string>>} */
  const indexes = new Map();
  for (const language of LANGUAGES) indexes.set(language, await loadIndex(options, language));
  /** @type {Record<string, string>} */
  const index = Object.fromEntries([...indexes].map(([language, entries]) => [language, indexHash(entries)]));

  const tables = planTables(LANGUAGES, indexes);
  const { parts, keep, todo } = planWork(tables, previous, (file) => existsSync(join(root, file)), options.rebuild === true);
  /** @type {Record<string, import('./lib/public-export.mjs').ManifestPart>} */
  const next = { ...keep };
  /** @type {string[]} */
  const updated = [];
  /** @type {string[]} */
  const failed = [];
  for (const [entry, needed] of todo) {
    let json;
    try {
      json = parseDeJson(await options.fetchText(`${FILE_BASE}${entry}`));
    } catch (error) {
      failed.push(entry);
      log(`::warning::${entry}: ${error instanceof Error ? error.message : String(error)}`);
      // Der bisherige Teil bleibt; die App erkennt am Index, dass er alt ist.
      for (const part of needed) {
        const old = previous?.parts[part.key];
        if (old && existsSync(join(root, old.file))) next[part.key] = old;
      }
      continue;
    }
    for (const part of needed) {
      const { text, entry: manifestPart } = derivePart(part, json);
      const target = join(root, manifestPart.file);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text);
      next[part.key] = manifestPart;
      updated.push(part.key);
    }
  }
  // Teile, die der Index nicht mehr nennt, fallen weg.
  for (const key of Object.keys(next)) if (!parts.has(key)) delete next[key];

  const { manifest, changed } = buildManifest(next, index, previous, options.now);
  if (changed) {
    await mkdir(root, { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
  }
  for (const file of staleFiles(await listFiles(join(root, 'parts')).then((files) => files.map((file) => `parts/${file}`)), manifest)) await rm(join(root, file));
  log(`Public export: ${Object.keys(manifest.parts).length} parts, ${updated.length} new${failed.length > 0 ? `, ${failed.length} files failed` : ''} (index en ${index['en']}, de ${index['de']})`);
  return { changed, index: `${index['en']}/${index['de']}`, parts: Object.keys(manifest.parts).length, updated, failed };
}

/** LZMA (Format „lzma alone“) mit `xz` entpacken; auf GitHub-Runnern vorhanden. @param {Uint8Array} bytes @returns {Promise<string>} */
export function unlzmaWithXz(bytes) {
  return new Promise((resolve, reject) => {
    const xz = spawn('xz', ['-dc', '--format=lzma'], { stdio: ['pipe', 'pipe', 'pipe'] });
    /** @type {Buffer[]} */
    const out = [];
    xz.stdout.on('data', (chunk) => out.push(chunk));
    xz.on('error', reject);
    xz.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out).toString('utf8')) : reject(new Error(`xz exited with ${code}`))));
    xz.stdin.on('error', reject);
    xz.stdin.end(Buffer.from(bytes));
  });
}

/** Werte für `GITHUB_OUTPUT`, streng geprüft (Script-Injection). @param {BuildResult} result */
export function outputLines(result) {
  const safe = (/** @type {string} */ text) => text.replace(/[^0-9a-f/]/g, '');
  return `changed=${result.changed ? 'true' : 'false'}\nindex=${safe(result.index)}\nparts=${Math.trunc(result.parts)}\nupdated=${Math.trunc(result.updated.length)}\nfailed=${Math.trunc(result.failed.length)}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  /** @param {string} url */
  const get = async (url) => {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(120 * 1000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  };
  try {
    const result = await build(process.env['DATA_DIR'] ?? ROOT, {
      fetchBytes: async (url) => new Uint8Array(await (await get(url)).arrayBuffer()),
      fetchText: async (url) => (await get(url)).text(),
      unlzma: unlzmaWithXz,
      now: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      log: (text) => console.log(text),
      rebuild: process.env['REBUILD'] === '1',
    });
    const output = process.env['GITHUB_OUTPUT'];
    if (output) await writeFile(output, outputLines(result), { flag: 'a' });
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
