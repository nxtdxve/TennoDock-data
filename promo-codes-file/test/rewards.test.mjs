// Zuordnung der Belohnungen zu Items (#135) mit erfundenen Daten in der Form des DE-Exports und von public-export-plus.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { DE_FILE_BASE, DE_INDEX_URLS, indexHash, loadNames, parseDeJson, parseIndex, PLUS_BASE, unlzmaWithXz } from '../lib/names.mjs';
import { deItems, indexFromItems, nameCandidates, nameIndex, nameKey, rewardPath } from '../lib/rewards.mjs';
import { DE_EXPORT, DE_INDEX, PLUS_DICT, PLUS_EXPORT } from './fixture.mjs';

const index = nameIndex([PLUS_EXPORT], PLUS_DICT);

describe('Namen', () => {
  it('Schlüssel ohne Satzzeichen und Grossschreibung', () => {
    assert.equal(nameKey('3-day Affinity Booster'), nameKey('3 Day Affinity Booster'));
    assert.equal(nameKey('Carry The Fire with Sprite!'), 'carrythefirewithsprite');
  });

  it('Kandidaten ohne Menge vorne und ohne Art hinten', () => {
    assert.deepEqual(nameCandidates('500 Orokin Ducats'), ['500 Orokin Ducats', 'Orokin Ducats']);
    assert.ok(nameCandidates('Golden Hand decoration').includes('Golden Hand'));
    assert.ok(nameCandidates('Carry The Fire with Sprite! Glyph').includes('Carry The Fire with Sprite!'));
  });
});

describe('rewardPath', () => {
  it('findet Items über den englischen Namen, auch mit angehängter Art oder Bindestrich', () => {
    assert.equal(rewardPath('Shiny Example Glyph', index), '/Lotus/Types/StoreItems/AvatarImages/ShinyExampleGlyph');
    assert.equal(rewardPath('Example Frame Display', index), '/Lotus/Types/Items/ShipDecos/ExampleFrameDisplay');
    assert.equal(rewardPath('3-day Affinity Booster', index), '/Lotus/Types/StoreItems/Boosters/AffinityBooster3DayStoreItem');
  });

  it('bei gleichen Namen das Item mit Symbol vor der Blaupause', () => {
    const shared = nameIndex(
      [
        {
          '/Lotus/Bp': { name: '/N' },
          '/Lotus/Item': { name: '/N', icon: 'x.png' },
        },
      ],
      { '/N': 'Nikana' },
    );
    assert.equal(rewardPath('Nikana', shared), '/Lotus/Item');
    assert.equal(rewardPath('Nikana', index), '/Lotus/Weapons/Tenno/Melee/Katana/Katana');
  });

  it('ohne Treffer undefined; fremde Formen fallen weg', () => {
    assert.equal(rewardPath('One-time 20% Platinum discount', index), undefined);
    assert.equal(nameIndex([{ x: { name: '/N' }, '/Lotus/A': 'kaputt' }], { '/N': 'X' }).size, 0);
    assert.equal(nameIndex([PLUS_EXPORT], undefined).size, 0);
  });
});

describe('deItems', () => {
  it('jedes Objekt mit Pfad und Namen, auch verschachtelt; Blaupausen nicht bevorzugt', () => {
    const items = deItems([DE_EXPORT.ExportSortieRewards, DE_EXPORT.ExportWeapons]);
    assert.ok(items.some((item) => item.path === '/Lotus/Types/StoreItems/Boosters/AffinityBooster3DayStoreItem' && item.name === '3 Day Affinity Booster'));
    assert.equal(rewardPath('Nikana', indexFromItems(items)), '/Lotus/Weapons/Tenno/Melee/Katana/Katana');
  });
});

describe('Index des DE-Exports', () => {
  it('liest die Zeilen pro Datei; der Hash ändert sich mit einer genutzten Datei', () => {
    const index = parseIndex(DE_INDEX);
    assert.equal(index.get('ExportWeapons'), 'ExportWeapons_en.json!00_weapons1');
    const other = parseIndex(DE_INDEX.replace('00_weapons1', '00_weapons2'));
    assert.match(indexHash(index), /^[0-9a-f]{16}$/);
    assert.notEqual(indexHash(index), indexHash(other));
    assert.equal(indexHash(parseIndex(DE_INDEX.replace('00_regions1', '00_regions2'))), indexHash(index));
  });

  it('JSON mit Steuerzeichen in Texten', () => {
    assert.deepEqual(parseDeJson('{"a":"x\ny"}'), { a: 'x y' });
  });
});

describe('loadNames', () => {
  /**
   * Netz im Speicher: DE-Index, DE-Dateien und plus; `failDe`: der DE-Export ist nicht erreichbar; `blocked`: Adressen des
   * Index, die mit 403 antworten (wie `origin` für den GitHub-Runner).
   */
  function fakeNet({ failDe = false, blocked = [] } = {}) {
    const urls = [];
    const fetchBytes = async (url) => {
      urls.push(url);
      if (failDe) throw new Error('HTTP 503');
      if (blocked.includes(url)) throw new Error(`HTTP 403 for ${url}`);
      return new Uint8Array([1, 2, 3]);
    };
    const fetchText = async (url) => {
      urls.push(url);
      if (url.startsWith(PLUS_BASE)) return JSON.stringify(url.endsWith('dict.en.json') ? PLUS_DICT : url.endsWith('ExportFlavour.json') ? PLUS_EXPORT : {});
      const file = /Manifest\/(Export\w+)_en\.json!/.exec(url)?.[1] ?? '';
      return JSON.stringify(DE_EXPORT[file] ?? {});
    };
    return { urls, options: { userAgent: 'test', log: () => undefined, fetchBytes, fetchText, unlzma: async () => DE_INDEX } };
  }

  it('lädt Index und Dateien des DE-Exports, mit Hash', async () => {
    const net = fakeNet();
    const names = await loadNames(net.options);
    assert.equal(names.source, 'de');
    assert.equal(names.hash, indexHash(parseIndex(DE_INDEX)));
    assert.equal(rewardPath('3-day Affinity Booster', names.index), '/Lotus/Types/StoreItems/Boosters/AffinityBooster3DayStoreItem');
    assert.equal(net.urls[0], DE_INDEX_URLS[0]);
    assert.ok(DE_INDEX_URLS[0]?.startsWith('https://content.warframe.com/'));
    assert.ok(net.urls.slice(1).every((url) => url.startsWith(DE_FILE_BASE)));
    assert.equal(new Set(net.urls).size, net.urls.length);
  });

  it('mit bekanntem, gleichem Hash nur der Index, keine Dateien', async () => {
    const net = fakeNet();
    const names = await loadNames({ ...net.options, knownHash: indexHash(parseIndex(DE_INDEX)) });
    assert.deepEqual(names, { source: 'unchanged', hash: indexHash(parseIndex(DE_INDEX)) });
    assert.deepEqual(net.urls, [DE_INDEX_URLS[0]]);
  });

  it('Index zuerst von content, dann von origin (Runner-403 vom 06.11.2026), mit Grund im Log', async () => {
    const net = fakeNet({ blocked: [DE_INDEX_URLS[0]] });
    const logs = [];
    const names = await loadNames({ ...net.options, log: (text) => logs.push(text) });
    assert.equal(names.source, 'de');
    assert.deepEqual(net.urls.slice(0, 2), DE_INDEX_URLS);
    assert.ok(logs.some((text) => text.includes('from origin.warframe.com') && text.includes('content.warframe.com: HTTP 403')));
    const both = fakeNet({ blocked: [...DE_INDEX_URLS] });
    const fallback = await loadNames({ ...both.options, log: (text) => logs.push(text) });
    assert.equal(fallback.source, 'plus');
    assert.ok(logs.some((text) => text.includes('::warning::') && text.includes('no index')));
  });

  it('ohne DE-Export die Namen aus public-export-plus, ohne Hash', async () => {
    const net = fakeNet({ failDe: true });
    const logs = [];
    const names = await loadNames({ ...net.options, log: (text) => logs.push(text) });
    assert.equal(names.source, 'plus');
    assert.equal(names.hash, undefined);
    assert.equal(rewardPath('Zylok', names.index), '/Lotus/Weapons/Tenno/Pistols/ConclaveLeverPistol/ConclaveLeverPistol');
    assert.ok(logs.some((text) => text.includes('::warning::')));
  });

  it('auch wenn eine genutzte Datei im Index fehlt', async () => {
    const net = fakeNet();
    const names = await loadNames({ ...net.options, unlzma: async () => DE_INDEX.replace(/ExportWeapons[^\n]*\n/, '') });
    assert.equal(names.source, 'plus');
  });
});

describe('unlzmaWithXz', () => {
  const xz = spawnSync('xz', ['--version']);
  it('entpackt LZMA mit xz vom Rechner', { skip: xz.status !== 0 && 'xz fehlt' }, async () => {
    const packed = spawnSync('xz', ['-zc', '--format=lzma'], { input: 'ExportWeapons_en.json!00_x\n' }).stdout;
    assert.equal(await unlzmaWithXz(new Uint8Array(packed)), 'ExportWeapons_en.json!00_x\n');
    await assert.rejects(unlzmaWithXz(new Uint8Array([1, 2, 3])), /xz exited/);
  });
});
