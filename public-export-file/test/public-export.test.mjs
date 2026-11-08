// @ts-check
// Offline: Index, DE-Dateien und LZMA sind Attrappen; geschrieben wird in einen Ordner im Temp-Verzeichnis.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { build, FILE_BASE, INDEX_URLS, outputLines } from '../build.mjs';
import { collectNamesPart, planTables } from '../lib/derive.mjs';
import { buildManifest, parseIndex, partFile, planWork, readManifest, staleFiles } from '../lib/public-export.mjs';

/** @param {Record<string, string>} hashes */
const indexText = (language, hashes = {}) =>
  [`ExportResources_${language}.json!00_${hashes['ExportResources'] ?? 'r1'}`, `ExportWarframes_${language}.json!00_w1`, `ExportUpgrades_${language}.json!00_u1`, `ExportRegions_${language}.json!00_g1`, 'ExportManifest.json!00_img'].join('\r\n');

/** @type {Record<string, unknown>} */
const FILES = {
  'ExportResources_en.json!00_r1': { ExportResources: [{ uniqueName: '/Lotus/Kuva', name: 'Kuva' }, { uniqueName: '/Lotus/Part', name: 'Rhino Prime Systems', primeSellingPrice: 45 }] },
  'ExportResources_en.json!00_r2': { ExportResources: [{ uniqueName: '/Lotus/Kuva', name: 'Kuva' }, { uniqueName: '/Lotus/New', name: 'New' }] },
  'ExportResources_de.json!00_r1': { ExportResources: [{ uniqueName: '/Lotus/Kuva', name: 'Kuva (de)' }] },
  'ExportWarframes_en.json!00_w1': { ExportWarframes: [{ uniqueName: '/Lotus/Volt', name: 'Volt', productCategory: 'Suits' }] },
  'ExportWarframes_de.json!00_w1': { ExportWarframes: [{ uniqueName: '/Lotus/Volt', name: 'Volt' }] },
  'ExportUpgrades_en.json!00_u1': { ExportUpgrades: [{ uniqueName: '/Lotus/Upgrades/Mods/Rifle/Serration', name: 'Serration', polarity: 'AP_ATTACK', rarity: 'UNCOMMON', fusionLimit: 10, levelStats: [{ stats: ['+15% Damage'] }] }] },
  'ExportUpgrades_de.json!00_u1': { ExportUpgrades: [{ uniqueName: '/Lotus/Upgrades/Mods/Rifle/Serration', name: 'Serration', levelStats: [{ stats: ['+15 % Schaden'] }] }] },
  'ExportRegions_en.json!00_g1': { ExportRegions: [{ uniqueName: 'SolNode1', name: 'Galatea', systemName: 'Neptune' }] },
  'ExportRegions_de.json!00_g1': { ExportRegions: [{ uniqueName: 'SolNode1', name: 'Galatea', systemName: 'Neptun' }] },
  'ExportManifest.json!00_img': { Manifest: [{ uniqueName: '/Lotus/Kuva', textureLocation: '/Kuva.png!00_k' }] },
};

/** @type {string[]} */
const dirs = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** @param {{ hashes?: Record<string, string>, failing?: string[], contentIndexDown?: boolean }} [setup] */
function fakeNet(setup = {}) {
  /** @type {string[]} */
  const calls = [];
  return {
    calls,
    options: {
      fetchBytes: async (/** @type {string} */ url) => {
        calls.push(url);
        if (setup.contentIndexDown && url.startsWith('https://content.')) throw new Error('HTTP 403');
        const language = /index_(\w+)\.txt/.exec(url)?.[1] ?? 'en';
        return new TextEncoder().encode(indexText(language, language === 'en' ? setup.hashes : {}));
      },
      fetchText: async (/** @type {string} */ url) => {
        calls.push(url);
        const entry = url.slice(FILE_BASE.length);
        if (setup.failing?.includes(entry) || !(entry in FILES)) throw new Error('HTTP 404');
        return JSON.stringify(FILES[entry]);
      },
      unlzma: async (/** @type {Uint8Array} */ bytes) => new TextDecoder().decode(bytes),
      now: '2026-11-08T12:00:00Z',
      log: () => undefined,
    },
  };
}

async function tempRoot() {
  const dir = await mkdtemp(join(tmpdir(), 'tennodock-pe-'));
  dirs.push(dir);
  return dir;
}

const fileCalls = (/** @type {string[]} */ calls) => calls.filter((url) => url.startsWith(FILE_BASE));

describe('public export parts', () => {
  it('erster Lauf: alle Teile mit Hash im Namen, das Manifest nennt Zeile, Format und SHA-256', async () => {
    const root = await tempRoot();
    const net = fakeNet();
    const result = await build(root, net.options);
    assert.equal(result.changed, true);
    assert.deepEqual(result.failed, []);
    const manifest = readManifest(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')));
    assert.ok(manifest);
    // Namen en/de pro Datei, Mod-Texte, Katalog, Regionen, Bildpfade, Nightwave fehlt (keine Datei im Index).
    assert.ok(manifest.parts['names/en/ExportResources']);
    assert.ok(manifest.parts['names/de/ExportResources']);
    assert.ok(manifest.parts['catalog/resources']);
    assert.ok(manifest.parts['modstats/de/ExportUpgrades']);
    assert.ok(manifest.parts['regions/de']);
    assert.ok(manifest.parts['images']);
    for (const part of Object.values(manifest.parts)) {
      const text = await readFile(join(root, part.file), 'utf8');
      assert.equal(createHash('sha256').update(text).digest('hex'), part.sha256);
      assert.equal(part.file, partFile(part.file.slice(6).replace(/\.[0-9a-f]{16}\.json$/, ''), part.sha256));
    }
    // Der Teil ist genau die Ableitung der App.
    const names = JSON.parse(await readFile(join(root, manifest.parts['names/de/ExportResources'].file), 'utf8'));
    assert.deepEqual(names, collectNamesPart(FILES['ExportResources_de.json!00_r1'], 'de'));
    // Jede DE-Datei höchstens einmal.
    assert.equal(new Set(fileCalls(net.calls)).size, fileCalls(net.calls).length);
  });

  it('gleicher Index: nichts geladen, kein neues Manifest', async () => {
    const root = await tempRoot();
    await build(root, fakeNet().options);
    const before = await readFile(join(root, 'manifest.json'), 'utf8');
    const net = fakeNet();
    const result = await build(root, { ...net.options, now: '2026-11-08T12:30:00Z' });
    assert.equal(result.changed, false);
    assert.deepEqual(fileCalls(net.calls), []);
    assert.equal(await readFile(join(root, 'manifest.json'), 'utf8'), before);
  });

  it('eine geänderte Datei: nur sie kommt, nur ihre Teile sind neu, alte Dateien fallen weg', async () => {
    const root = await tempRoot();
    await build(root, fakeNet().options);
    const old = readManifest(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')));
    const net = fakeNet({ hashes: { ExportResources: 'r2' } });
    const result = await build(root, net.options);
    assert.deepEqual(fileCalls(net.calls), [`${FILE_BASE}ExportResources_en.json!00_r2`]);
    assert.deepEqual(result.updated.sort(), ['catalog/resources', 'names/en/ExportResources']);
    assert.equal(existsSync(join(root, old?.parts['names/en/ExportResources']?.file ?? '')), false);
    const files = await readdir(join(root, 'parts'), { recursive: true });
    assert.ok(files.length > 0);
  });

  it('scheitert eine Datei, bleibt ihr bisheriger Teil; der Index kommt notfalls von origin', async () => {
    const root = await tempRoot();
    await build(root, fakeNet().options);
    const old = readManifest(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')));
    const net = fakeNet({ hashes: { ExportResources: 'r2' }, failing: ['ExportResources_en.json!00_r2'], contentIndexDown: true });
    const result = await build(root, net.options);
    assert.deepEqual(result.failed, ['ExportResources_en.json!00_r2']);
    const manifest = readManifest(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')));
    assert.deepEqual(manifest?.parts['names/en/ExportResources'], old?.parts['names/en/ExportResources']);
    assert.ok(net.calls.includes(INDEX_URLS('en')[1] ?? ''));
  });

  it('Hilfen: Arbeit planen, Manifest nur bei Änderung neu, verwaiste Dateien, sichere Ausgabe', () => {
    const tables = planTables(['en'], new Map([['en', parseIndex(indexText('en'))]]));
    const first = planWork(tables, undefined, () => true, false);
    assert.equal(Object.keys(first.keep).length, 0);
    assert.ok(first.todo.has('ExportResources_en.json!00_r1'));
    const { manifest } = buildManifest({}, { en: 'a' }, undefined, 'T1');
    assert.equal(buildManifest({}, { en: 'a' }, manifest, 'T2').manifest.generatedAt, 'T1');
    assert.equal(buildManifest({}, { en: 'b' }, manifest, 'T2').changed, true);
    assert.deepEqual(staleFiles(['parts/a.json', 'parts/b.json'], { ...manifest, parts: { x: { entry: 'e', format: 'f', file: 'parts/a.json', sha256: 's', bytes: 1 } } }), ['parts/b.json']);
    assert.equal(outputLines({ changed: true, index: 'ab12/cd34$(x)', parts: 3, updated: ['a'], failed: [] }), 'changed=true\nindex=ab12/cd34\nparts=3\nupdated=1\nfailed=0\n');
  });
});
