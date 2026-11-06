// @ts-check
// Baut die Packs und das Manifest der Spiel-Assets (#126) im öffentlichen Daten-Repo:
//
//   node assets-file/build.mjs           assets/v1/packs/<Familie>.json und assets/v1/manifest.json neu schreiben
//   node assets-file/build.mjs --check   nur prüfen, ob beides zu den Bildern passt (Workflow `assets.yml`)
//
// Die Bilder liegen von Hand gepflegt in assets/v1/<Familie>/ mit SOURCES.md (Herkunft, Lizenz, Stand) und origin.json
// (Quelle pro Datei fürs Manifest). Keine Abhängigkeiten ausser Node (ab 20), kein Netz. TennoDock lädt das Manifest
// höchstens einmal pro UTC-Tag und ein Pack nur, wenn sich sein Hash ändert. Doku: docs/pakete/126-assets.md im App-Repo.
// Im TennoDock-Repo liegt das Skript 1:1 unter `tools/tennodock-data/`; die Bilder nur hier.

import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildFamily, buildManifest, FAMILIES } from './lib/assets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'v1');

/**
 * @param {string} root Ordner `assets/v1`
 * @param {{ check?: boolean, today?: string }} [options]
 * @returns {Promise<{ changed: string[] }>} Dateien, die neu sind oder nicht passen (relativ zu `root`)
 */
export async function build(root, options = {}) {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  /** @type {Record<string, import('./lib/assets.mjs').FamilyEntry>} */
  const families = {};
  /** @type {Map<string, string>} */
  const outputs = new Map();
  for (const family of FAMILIES) {
    const dir = join(root, family);
    const files = new Map();
    for (const name of (await readdir(dir)).sort()) if (/\.(png|webp)$/i.test(name)) files.set(name, await readFile(join(dir, name)));
    const sources = await readFile(join(dir, 'SOURCES.md'), 'utf8');
    const origin = JSON.parse(await readFile(join(dir, 'origin.json'), 'utf8'));
    const { entry, pack } = buildFamily(family, files, sources, origin);
    families[family] = entry;
    outputs.set(entry.pack, pack);
  }
  const manifestPath = join(root, 'manifest.json');
  const previous = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : undefined;
  outputs.set('manifest.json', `${JSON.stringify(buildManifest(families, previous, today), null, 2)}\n`);
  const changed = [];
  for (const [file, text] of outputs) {
    const path = join(root, file);
    const current = existsSync(path) ? await readFile(path, 'utf8') : undefined;
    if (current === text) continue;
    changed.push(file);
    if (!options.check) await writeFile(path, text);
  }
  return { changed };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const check = process.argv.includes('--check');
  try {
    const { changed } = await build(ROOT, { check });
    if (check && changed.length) {
      console.error(`Out of date: ${changed.join(', ')}. Run "node assets-file/build.mjs" and commit the result.`);
      process.exitCode = 1;
    } else console.log(changed.length ? `Written: ${changed.join(', ')}` : 'Up to date');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
