// @ts-check
// Reine Teile der Action `public-export.yml` (#179): Index lesen, entscheiden, welche Teile neu entstehen, Dateinamen und
// Manifest bauen. Ohne Netz und ohne Dateien, damit die Tests offline laufen. Die Ableitung selbst kommt aus derive.mjs
// (erzeugt aus dem App-Repo), damit App und Daten-Repo genau gleich rechnen.

import { createHash } from 'node:crypto';

/** Sprachen der App (`GAME_LANGUAGES` im App-Repo); Englisch zuerst: Katalog, Bildpfade und Nightwave kommen daraus. */
export const LANGUAGES = ['en', 'de'];
export const MANIFEST_FORMAT = 'tennodock-public-export';
export const MANIFEST_VERSION = 1;

/**
 * @typedef {{ entry: string, format: string, file: string, sha256: string, bytes: number }} ManifestPart
 * @typedef {{ format: string, v: number, generatedAt: string, index: Record<string, string>, parts: Record<string, ManifestPart> }} Manifest
 * @typedef {{ key: string, entry: string, format: string, derive(json: unknown): unknown }} PartPlan
 * @typedef {{ key: string, parts: PartPlan[] }} TablePlan
 */

/** Zeilen `ExportUpgrades_en.json!00_<hash>` als Map Datei → Zeile (wie `parseIndex` in der App). @param {string} text */
export function parseIndex(text) {
  /** @type {Map<string, string>} */
  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const file = trimmed.split('!')[0];
    if (file && trimmed.includes('!')) entries.set(file, trimmed);
  }
  return entries;
}

/** Kurzer Hash eines Index für Protokoll und Commit-Text. @param {Map<string, string>} index */
export function indexHash(index) {
  return createHash('sha256')
    .update([...index.values()].sort().join('\n'))
    .digest('hex')
    .slice(0, 16);
}

/** SHA-256 als Hex. @param {string} text */
export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Datei eines Teils: Schlüssel und die ersten 16 Zeichen des Hashs, damit eine Adresse nie zwei Inhalte hat. @param {string} key @param {string} hash */
export const partFile = (key, hash) => `parts/${key}.${hash.slice(0, 16)}.json`;

/** Gelesenes Manifest, nur im eigenen Format; sonst `undefined` (dann entsteht alles neu). @param {unknown} raw @returns {Manifest | undefined} */
export function readManifest(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = /** @type {Record<string, unknown>} */ (raw);
  if (record['format'] !== MANIFEST_FORMAT || record['v'] !== MANIFEST_VERSION || !record['parts'] || typeof record['parts'] !== 'object') return undefined;
  return /** @type {Manifest} */ (raw);
}

/**
 * Was zu tun ist: Teile, die das Manifest im selben Stand hat, bleiben; die übrigen pro Index-Zeile gesammelt, damit jede
 * DE-Datei höchstens einmal kommt. `exists`: ob eine Datei des Manifests noch im Repo liegt.
 * @param {TablePlan[]} tables @param {Manifest | undefined} manifest @param {(file: string) => boolean} exists @param {boolean} rebuild
 */
export function planWork(tables, manifest, exists, rebuild) {
  /** @type {Map<string, PartPlan>} */
  const parts = new Map();
  for (const table of tables) for (const part of table.parts) parts.set(part.key, part);
  /** @type {Record<string, ManifestPart>} */
  const keep = {};
  /** @type {Map<string, PartPlan[]>} */
  const todo = new Map();
  for (const part of parts.values()) {
    const known = manifest?.parts[part.key];
    if (!rebuild && known && known.entry === part.entry && known.format === part.format && exists(known.file)) {
      keep[part.key] = known;
      continue;
    }
    todo.set(part.entry, [...(todo.get(part.entry) ?? []), part]);
  }
  return { parts, keep, todo };
}

/**
 * Teil als Text und Eintrag fürs Manifest; der Text ist genau das, was die App lädt und prüft.
 * @param {PartPlan} part @param {unknown} json @returns {{ text: string, entry: ManifestPart }}
 */
export function derivePart(part, json) {
  const text = JSON.stringify(part.derive(json));
  const hash = sha256(text);
  return { text, entry: { entry: part.entry, format: part.format, file: partFile(part.key, hash), sha256: hash, bytes: Buffer.byteLength(text) } };
}

/**
 * Neues Manifest. `generatedAt` bleibt, wenn sich kein Teil geändert hat, damit ein Lauf ohne Änderung keinen Commit macht.
 * @param {Record<string, ManifestPart>} parts @param {Record<string, string>} index @param {Manifest | undefined} previous @param {string} now
 * @returns {{ manifest: Manifest, changed: boolean }}
 */
export function buildManifest(parts, index, previous, now) {
  const sorted = Object.fromEntries(Object.entries(parts).sort(([a], [b]) => a.localeCompare(b)));
  const changed = !previous || JSON.stringify(previous.parts) !== JSON.stringify(sorted) || JSON.stringify(previous.index) !== JSON.stringify(index);
  return { manifest: { format: MANIFEST_FORMAT, v: MANIFEST_VERSION, generatedAt: changed ? now : (previous?.generatedAt ?? now), index, parts: sorted }, changed };
}

/** Dateien unter `parts/`, die das Manifest nicht mehr nennt. @param {string[]} files @param {Manifest} manifest */
export function staleFiles(files, manifest) {
  const used = new Set(Object.values(manifest.parts).map((part) => part.file));
  return files.filter((file) => !used.has(file));
}

/** JSON des DE-Exports; DE schreibt manchmal Steuerzeichen in Texte. @param {string} text @returns {unknown} */
export function parseDeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/[\u0000-\u001f]/g, ' '));
  }
}
