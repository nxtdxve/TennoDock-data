// @ts-check
// Spiel-Assets für TennoDock (#126): pro Familie ein Pack (alle Bilder als Data-URL in einer JSON-Datei) und ein Manifest
// mit Hash, Grösse, Massen und Herkunft jeder Datei. Reine Funktionen ohne Dateizugriff; build.mjs liest und schreibt.

import { createHash } from 'node:crypto';

/** Familien in `assets/v1/`; jede hat einen eigenen Ordner, eine `SOURCES.md` und eine `origin.json`. */
export const FAMILIES = ['mod-frames', 'syndicate-logos', 'focus-glyphs'];

/** Herkunft, auf die `origin.json` verweist. */
export const SOURCES = {
  wiki: 'WARFRAME Wiki (wiki.warframe.com), images © Digital Extremes',
  'genesis-assets': 'WFCD/genesis-assets (Apache-2.0 for the collection), images © Digital Extremes',
};

export const FORMAT = 'tennodock-assets';
export const PACK_FORMAT = 'tennodock-asset-pack';
export const VERSION = 1;

/** Grenze pro Pack, damit ein Versehen (z. B. ein Bild in voller Grösse) nicht jedem Nutzer Megabytes schickt. */
export const MAX_PACK_BYTES = 1024 * 1024;

const TYPES = { png: 'image/png', webp: 'image/webp' };

/** @param {Uint8Array} bytes */
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Breite und Höhe aus dem Kopf einer PNG- oder WebP-Datei; sonst `undefined`.
 * @param {Uint8Array} buf
 * @returns {{ w: number, h: number, type: 'png' | 'webp' } | undefined}
 */
export function imageSize(buf) {
  const b = Buffer.from(buf);
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('ascii', 12, 16) === 'IHDR') {
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), type: 'png' };
  }
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, type: 'webp' };
    }
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1, type: 'webp' };
    }
    if (chunk === 'VP8X') {
      return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1, type: 'webp' };
    }
  }
  return undefined;
}

/**
 * @typedef {{ file: string, sha256: string, bytes: number, w: number, h: number, src: string }} FileEntry
 * @typedef {{ pack: string, sha256: string, bytes: number, files: Record<string, FileEntry> }} FamilyEntry
 * @typedef {{ format: string, v: number, asOf: string, sources: Record<string, string>, families: Record<string, FamilyEntry> }} Manifest
 * @typedef {{ default: string, files?: Record<string, string> }} Origin
 */

/**
 * Prüft und packt eine Familie. `files`: Dateiname → Inhalt (nur Bilder), `sourcesMd`: Inhalt von SOURCES.md.
 * Wirft bei Fehlern mit einer Liste aller Probleme.
 * @param {string} family
 * @param {Map<string, Uint8Array>} files
 * @param {string} sourcesMd
 * @param {Origin} origin
 * @returns {{ entry: FamilyEntry, pack: string }}
 */
export function buildFamily(family, files, sourcesMd, origin) {
  const problems = [];
  /** @type {Record<string, FileEntry>} */
  const entries = {};
  /** @type {Record<string, string>} */
  const parts = {};
  const names = [...files.keys()].sort();
  for (const file of names) {
    const match = /^([A-Za-z0-9-]+)\.(png|webp)$/.exec(file);
    if (!match) {
      problems.push(`${family}/${file}: only .png and .webp with letters, digits and "-"`);
      continue;
    }
    const [, name, ext] = /** @type {[string, string, 'png' | 'webp']} */ (/** @type {unknown} */ (match));
    const bytes = /** @type {Uint8Array} */ (files.get(file));
    const size = imageSize(bytes);
    if (!size || size.type !== ext) {
      problems.push(`${family}/${file}: not a readable ${ext} file`);
      continue;
    }
    if (entries[name]) {
      problems.push(`${family}/${file}: more than one file named "${name}"`);
      continue;
    }
    if (!sourcesMd.includes(`| ${file} |`)) problems.push(`${family}/${file}: missing in SOURCES.md`);
    const src = origin.files?.[name] ?? origin.default;
    if (!(src in SOURCES)) problems.push(`${family}/${file}: unknown source "${src}" in origin.json`);
    entries[name] = { file: `${family}/${file}`, sha256: sha256(bytes), bytes: bytes.length, w: size.w, h: size.h, src };
    parts[name] = `data:${TYPES[ext]};base64,${Buffer.from(bytes).toString('base64')}`;
  }
  for (const name of Object.keys(origin.files ?? {})) if (!entries[name]) problems.push(`${family}: origin.json names "${name}", but there is no such file`);
  if (names.length === 0) problems.push(`${family}: no images`);
  const pack = JSON.stringify({ format: PACK_FORMAT, v: VERSION, family, parts });
  const packBytes = Buffer.byteLength(pack);
  if (packBytes > MAX_PACK_BYTES) problems.push(`${family}: pack has ${packBytes} bytes, more than ${MAX_PACK_BYTES}`);
  if (problems.length) throw new Error(problems.join('\n'));
  return { entry: { pack: `packs/${family}.json`, sha256: sha256(Buffer.from(pack)), bytes: packBytes, files: entries }, pack };
}

/**
 * Manifest aus den Familien. `asOf` bleibt wie im bisherigen Manifest, solange sich keine Familie ändert; sonst `today`.
 * So ist ein Neubau ohne Änderung byte-gleich, und die App nimmt nie ein älteres Manifest.
 * @param {Record<string, FamilyEntry>} families
 * @param {Manifest | undefined} previous
 * @param {string} today JJJJ-MM-TT (UTC)
 * @returns {Manifest}
 */
export function buildManifest(families, previous, today) {
  const same = previous !== undefined && JSON.stringify(previous.families) === JSON.stringify(families);
  return { format: FORMAT, v: VERSION, asOf: same ? previous.asOf : today, sources: SOURCES, families };
}
