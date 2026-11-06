// @ts-check
import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from '../build.mjs';
import { FAMILIES, imageSize } from '../lib/assets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'v1');
const temp = [];
after(async () => {
  for (const dir of temp) await rm(dir, { recursive: true, force: true });
});

/** Kopie von assets/v1 in einen eigenen Ordner, damit die Tests nichts im Repo ändern. */
async function copy() {
  const dir = await mkdtemp(join(tmpdir(), 'assets-'));
  temp.push(dir);
  await cp(ROOT, dir, { recursive: true });
  return dir;
}

const names = async (family) => (await readdir(join(ROOT, family))).filter((file) => /\.(png|webp)$/.test(file)).map((file) => file.replace(/\.(png|webp)$/, ''));

describe('Packs und Manifest im Repo', () => {
  it('passen zu den Bildern (sonst: node assets-file/build.mjs)', async () => {
    assert.deepEqual((await build(await copy(), { check: true })).changed, []);
  });

  it('nennen jede Familie mit Pack, Hash und Grösse', async () => {
    const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
    assert.equal(manifest.format, 'tennodock-assets');
    assert.equal(manifest.v, 1);
    assert.match(manifest.asOf, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(Object.keys(manifest.families), FAMILIES);
    for (const family of FAMILIES) {
      const pack = await readFile(join(ROOT, manifest.families[family].pack));
      assert.equal(pack.length, manifest.families[family].bytes);
    }
  });
});

describe('Inhalt der Familien (was TennoDock braucht)', () => {
  it('mod-frames: alle Teile der Karten, die die App zusammensetzt', async () => {
    const files = await names('mod-frames');
    const needed = [
      ...['Bronze', 'Silver', 'Gold', 'Legendary', 'Riven'].flatMap((set) => ['FrameTop', 'FrameBottom', 'CornerLights', 'SideLight', 'LowerTab', 'TopRightBacker'].map((part) => `${set}${part}`)),
      ...['Bronze', 'Silver', 'Gold', 'Legendary'].map((set) => `${set}Background`),
      ...['Common', 'Uncommon', 'Rare', 'Legendary'].map((rarity) => `ArcaneBackground${rarity}`),
      'RankSlotActive',
      'RankSlotEmpty',
      'RankCompleteLine',
      'Reset',
      ...['FrameTop', 'FrameBottom', 'SideLight', 'Background', 'BottomLight'].map((part) => `Galvanized${part}`),
      ...['FrameTop', 'FrameBottom', 'Background'].map((part) => `Amalgam${part}`),
      ...['FrameTop', 'FrameBottom', 'SideSmoke', 'CornerLights'].map((part) => `Peculiar${part}`),
      ...['FrameTop', 'FrameBottom', 'SideLight'].map((part) => `Archon${part}`),
      ...['FrameTop', 'FrameBottom'].map((part) => `Umbra${part}`),
      'RequiemModFrame',
      'RequiemModCharge',
      ...['Chaos', 'Decay', 'Form', 'Light', 'Order', 'Time', 'Truth', 'Void'].map((rune) => `ImmortalRuneGlow${rune}`),
    ];
    assert.deepEqual(
      needed.filter((name) => !files.includes(name)),
      [],
    );
  });

  it('syndicate-logos: die zehn Syndikate ohne Logo von DE, 256 × 256', async () => {
    const files = await names('syndicate-logos');
    assert.deepEqual(files.sort(), ['CetusSyndicate', 'EntratiLabSyndicate', 'EntratiSyndicate', 'HexSyndicate', 'KahlSyndicate', 'NecraloidSyndicate', 'NightcapJournalSyndicate', 'QuillsSyndicate', 'VentKidsSyndicate', 'ZarimanSyndicate']);
    for (const file of await readdir(join(ROOT, 'syndicate-logos'))) {
      if (file.endsWith('.webp')) assert.deepEqual(imageSize(await readFile(join(ROOT, 'syndicate-logos', file))), { w: 256, h: 256, type: 'webp' });
    }
  });

  it('focus-glyphs: 75 Knoten, je fünfzehn pro Schule', async () => {
    const files = await names('focus-glyphs');
    assert.equal(files.length, 75);
    for (const school of ['Attack', 'Defense', 'Power', 'Tactic', 'Ward']) assert.equal(files.filter((name) => name.startsWith(`${school}-`)).length, 15, school);
  });
});

describe('build', () => {
  it('schreibt neue Packs und einen neuen Stand, wenn sich ein Bild ändert, und meldet es im Prüfmodus', async () => {
    const dir = await copy();
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    const file = join(dir, 'mod-frames', 'RankSlotEmpty.png');
    const bytes = await readFile(file);
    await writeFile(file, Buffer.concat([bytes, Buffer.from([0])]));
    assert.deepEqual((await build(dir, { check: true, today: '2099-01-01' })).changed.sort(), ['manifest.json', 'packs/mod-frames.json']);
    // Im Prüfmodus bleibt alles, wie es war.
    assert.equal(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')).asOf, manifest.asOf);
    await build(dir, { today: '2099-01-01' });
    const next = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    assert.equal(next.asOf, '2099-01-01');
    assert.notEqual(next.families['mod-frames'].sha256, manifest.families['mod-frames'].sha256);
    assert.equal(next.families['focus-glyphs'].sha256, manifest.families['focus-glyphs'].sha256);
    assert.deepEqual((await build(dir, { check: true, today: '2099-01-02' })).changed, []);
  });

  it('bricht ab, wenn eine Datei in SOURCES.md fehlt', async () => {
    const dir = await copy();
    await writeFile(join(dir, 'focus-glyphs', 'SOURCES.md'), '# leer\n');
    await assert.rejects(build(dir, { check: true }), /missing in SOURCES\.md/);
  });
});
