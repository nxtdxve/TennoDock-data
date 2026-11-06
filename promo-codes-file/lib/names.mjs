// @ts-check
// Englische Namen der Items für die Zuordnung der Belohnungen (#135). Quelle ist der DE-Export (Entscheidung vom 06.11.2026:
// dieselbe Quelle wie die Bilder der App; public-export-plus hinkte nach, 5 von 14 Belohnungen fehlten dort):
//
//   1. Index `index_en.txt.lzma` (rund 0,5 KB), zuerst von content.warframe.com, dann von origin.warframe.com (`DE_INDEX_URLS`),
//      entpackt mit `xz` vom Runner (keine npm-Abhängigkeit).
//   2. Ist ein Hash bekannt und unverändert (nur Neuzuordnung, keine neue Belohnung), endet es hier.
//   3. Sonst die Dateien in `DE_FILES` von content.warframe.com (rund 6,7 MB, ohne gzip), nur in der Action.
//
// Scheitert der DE-Export, gelten die Namen aus public-export-plus (GitHub, rund 1,3 MB mit gzip) als Rückfall.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DE_FILES, deItems, indexFromItems, nameIndex, PLUS_DICT, PLUS_FILES } from './rewards.mjs';

/**
 * Index des DE-Exports, in dieser Reihenfolge. `origin.warframe.com` antwortete dem GitHub-Runner am 06.11.2026 mit 403
 * (lokal 200 mit demselben User-Agent, also wohl die IP des Rechenzentrums). `content.warframe.com` liefert denselben Index
 * (gleicher Inhalt und ETag, `no-cache`) und auch die Export-Dateien.
 */
export const DE_INDEX_URLS = ['https://content.warframe.com/PublicExport/index_en.txt.lzma', 'https://origin.warframe.com/PublicExport/index_en.txt.lzma'];
export const DE_FILE_BASE = 'https://content.warframe.com/PublicExport/Manifest/';
export const PLUS_BASE = 'https://raw.githubusercontent.com/calamity-inc/warframe-public-export-plus/senpai/';

/**
 * @typedef {{ source: 'de' | 'plus' | 'unchanged' | 'none', hash?: string, index?: Map<string, string[]> }} Names
 *   `hash`: Hash des DE-Index für die genutzten Dateien (fehlt beim Rückfall); `index` fehlt bei `unchanged` und `none` (keine Quelle erreichbar).
 * @typedef {{
 *   userAgent: string,
 *   log(text: string): void,
 *   knownHash?: string,
 *   fetchBytes?(url: string): Promise<Uint8Array>,
 *   fetchText?(url: string): Promise<string>,
 *   unlzma?(bytes: Uint8Array): Promise<string>,
 * }} NameOptions `knownHash`: nur Neuzuordnung; bei gleichem Hash wird nichts geladen.
 */

/** Zeilen `ExportCustoms_en.json!00_<hash>` als Map Datei → Zeile. @param {string} text */
export function parseIndex(text) {
  /** @type {Map<string, string>} */
  const files = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^(Export\w+)_en\.json!\S+$/.exec(line.trim());
    if (match?.[1]) files.set(match[1], line.trim());
  }
  return files;
}

/** Kurzer Hash über die Einträge der genutzten Dateien; ändert sich, sobald eine davon neu ist. @param {Map<string, string>} index */
export function indexHash(index) {
  return createHash('sha256')
    .update(DE_FILES.map((file) => index.get(file) ?? '').join('\n'))
    .digest('hex')
    .slice(0, 16);
}

/** JSON des DE-Exports; DE schreibt manchmal Steuerzeichen in Texte. @param {string} text @returns {unknown} */
export function parseDeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/[\u0000-\u001f]/g, ' '));
  }
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

/** @param {string} userAgent */
function fetchers(userAgent) {
  /** @param {string} url */
  const get = async (url) => {
    const response = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(120 * 1000) });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response;
  };
  return {
    fetchBytes: async (/** @type {string} */ url) => new Uint8Array(await (await get(url)).arrayBuffer()),
    fetchText: async (/** @type {string} */ url) => (await get(url)).text(),
  };
}

/**
 * Index von der ersten Adresse in `DE_INDEX_URLS`, die antwortet; ein Fehlschlag vor einem Erfolg steht im Log. Wirft mit
 * allen Gründen, wenn keine antwortet.
 * @param {(url: string) => Promise<Uint8Array>} fetchBytes @param {(text: string) => void} log @returns {Promise<Uint8Array>}
 */
export async function fetchIndex(fetchBytes, log) {
  /** @type {string[]} */
  const failures = [];
  for (const url of DE_INDEX_URLS) {
    try {
      const bytes = await fetchBytes(url);
      if (failures.length > 0) log(`Public export index from ${new URL(url).host} (${failures.join('; ')})`);
      return bytes;
    } catch (error) {
      failures.push(`${new URL(url).host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`no index (${failures.join('; ')})`);
}

/** @param {NameOptions} options @returns {Promise<Names>} */
export async function loadNames(options) {
  const { userAgent, log, knownHash } = options;
  const net = fetchers(userAgent);
  const fetchBytes = options.fetchBytes ?? net.fetchBytes;
  const fetchText = options.fetchText ?? net.fetchText;
  const unlzma = options.unlzma ?? unlzmaWithXz;
  try {
    const index = parseIndex(await unlzma(await fetchIndex(fetchBytes, log)));
    const missing = DE_FILES.filter((file) => !index.has(file));
    if (missing.length > 0) throw new Error(`not in the index: ${missing.join(', ')}`);
    const hash = indexHash(index);
    if (knownHash === hash) {
      log(`Item names: public export unchanged (index ${hash})`);
      return { source: 'unchanged', hash };
    }
    const files = await Promise.all(DE_FILES.map(async (file) => parseDeJson(await fetchText(`${DE_FILE_BASE}${index.get(file)}`))));
    const names = indexFromItems(deItems(files));
    log(`Item names: ${names.size} from the public export (index ${hash})`);
    return { source: 'de', hash, index: names };
  } catch (error) {
    log(`::warning::Public export not available (${error instanceof Error ? error.message : String(error)}); using public-export-plus`);
  }
  try {
    const [dict, ...exports] = await Promise.all([PLUS_DICT, ...PLUS_FILES].map(async (file) => JSON.parse(await fetchText(`${PLUS_BASE}${file}.json`))));
    const names = nameIndex(exports, dict);
    log(`Item names: ${names.size} from public-export-plus`);
    return { source: 'plus', index: names };
  } catch (error) {
    // Ohne Namen trotzdem schreiben: Neue Codes kommen sofort, ihre Belohnungen erst beim nächsten Lauf mit Namen ein Bild.
    log(`::warning::No item names (${error instanceof Error ? error.message : String(error)}); rewards stay without an item for now`);
    return { source: 'none' };
  }
}
