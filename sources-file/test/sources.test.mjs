// @ts-check
// Erfundene kleine Seiten nach dem Muster des Wikis und Pfade nach dem Muster des Spiels.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { capturaSources, classify, codexNames, fighterNames, fighterPlaces, fragmentPlaces, missingIn, missingReport, shorten, sigilSource, sigilSources, songSources, tableSources, vendorNames } from '../lib/sources.mjs';

const LORE = '/Lotus/Types/Lore/Fragments/';
const dict = { '/L/Earth': 'Earth', '/L/Venus': 'Venus', '/L/Mem1': "The Business' Mem Fragment 1/5", '/L/Mem2': "The Business' Mem Fragment 2/5", '/L/Song': 'Gene Molds', '/L/Ash': 'Ash' };
const codex = {
  loreFragments: {
    [`${LORE}EarthFragmentA`]: { name: '/L/Earth' },
    [`${LORE}VenusFragmentA`]: { name: '/L/Venus' },
    [`${LORE}SolarisFragments/MemA`]: { name: '/L/Mem1' },
    [`${LORE}SolarisFragments/MemB`]: { name: '/L/Mem2' },
  },
  songs: { [`${LORE}MusicFragments/GeneMoldsSongFragment`]: { name: '/L/Song' } },
  fighterFrames: { [`${LORE}FrameFighterFragments/AshFighterFragment`]: { name: '/L/Ash', suit: '/Lotus/Powersuits/Ninja/Ninja' } },
};

describe('Arten und Texte (#164)', () => {
  it('ordnet Texte einer groben Art zu; Syndikat vor Quest', () => {
    assert.equal(classify('Purchased from Cephalon Suda offerings after completing the Octavia’s Anthem quest'), 'syndicate');
    assert.equal(classify('Sold by Baro Ki’Teer for 400,000 Credits'), 'baro');
    assert.equal(classify('Purchaseable from the Market for 50 Platinum'), 'market');
    assert.equal(classify('Awarded upon completing Awakening'), 'quest');
    assert.equal(classify('Obtained during Conquera event.'), 'event');
    assert.equal(classify('PS4™ Exclusive'), 'unavailable');
    assert.equal(classify('Something else'), 'other');
  });

  it('kürzt lange Texte am Satzende', () => {
    const long = `${'Sold by Baro Ki’Teer in the Concourse section of the Relay.'} ${'x'.repeat(200)}`;
    assert.equal(shorten(long), 'Sold by Baro Ki’Teer in the Concourse section of the Relay.');
  });

  it('Anker der Sigils', () => {
    assert.deepEqual(sigilSource('Enemy Drop Sigils'), { k: 'drop', t: 'Enemy drop' });
    assert.deepEqual(sigilSource("Baro Ki'Teer Sigils"), { k: 'baro', t: "Baro Ki'Teer" });
    assert.deepEqual(sigilSource('Red Veil'), { k: 'syndicate', t: 'Red Veil' });
    assert.deepEqual(sigilSource('Founder Sigils'), { k: 'unavailable', t: 'Founders Program' });
  });
});

describe('Collectibles (#164)', () => {
  it('Fragmente: per Name, sonst bei einem Ort pro Seite über den Ordner', () => {
    const pages = {
      'Fragments/Cephalon': '{{Fragments\n|fragment = Earth\n|planet = [[Earth]]\n}}\n{{Fragments\n|fragment = Venus\n|planet = [[Venus]]\n}}\n{{Fragments\n|fragment = Gone\n|planet = [[Mars]]\n}}',
      'Fragments/Solaris United': '{{Fragments\n|fragment = 1\n|planet = [[Venus]] ([[Orb Vallis]])\n}}',
    };
    const { found, unmatched } = fragmentPlaces(pages, codexNames(codex.loreFragments, dict));
    assert.deepEqual(found, {
      [`${LORE}EarthFragmentA`]: 'Earth',
      [`${LORE}VenusFragmentA`]: 'Venus',
      [`${LORE}SolarisFragments/MemA`]: 'Venus (Orb Vallis)',
      [`${LORE}SolarisFragments/MemB`]: 'Venus (Orb Vallis)',
    });
    // Nummern einer Seite mit nur einem Ort zählen nicht als „nicht gefunden“.
    assert.deepEqual(unmatched, ['Gone']);
  });

  it('Somachord: Ort, Händler oder anderer Weg', () => {
    const page = '=== Fragments ===\n{| class="listtable"\n! Location !! Song !! Required Scans\n|-\n| [[Earth|Earth]] || [[Gene Molds]] || 4\n|}\n=== Vendors ===\n{|\n! Vendor Name !! Song !! Price\n|-\n| [[Varzia]] || [[Gene Molds]] || 5\n|}';
    assert.deepEqual(songSources(page, codexNames(codex.songs, dict)).found, { [`${LORE}MusicFragments/GeneMoldsSongFragment`]: { place: 'Earth', vendor: 'Varzia' } });
  });

  it('Frame Fighter: Planet über den Warframe des Fragments', () => {
    const page = '===Frame Fighter Fragment Locations===\n{| class="listtable"\n|-\n!Planet\n!Warframes\n|-\n| [[Uranus]]\n| {{WF|Ash}}, {{WF|Nobody}}\n|}';
    const fighters = fighterNames(codex.fighterFrames, new Map([['/Lotus/Powersuits/Ninja/Ninja', 'Ash']]));
    assert.deepEqual(fighterPlaces(page, fighters), { found: { [`${LORE}FrameFighterFragments/AshFighterFragment`]: 'Uranus' }, unmatched: ['Nobody'] });
  });
});

describe('Items (#164)', () => {
  const items = [
    { path: '/Lotus/Types/Items/MiscItems/PhotoboothTileCetusTown', name: 'Cetus Scene' },
    { path: '/Lotus/Upgrades/Skins/Scarves/ErosionCape', name: 'Abrasys Syandana' },
    { path: '/Lotus/Upgrades/Skins/Scarves/OtherCape', name: 'Other Syandana' },
    { path: '/Lotus/Upgrades/Skins/Sigils/BossSigilAladV', name: 'Alad V Sigil' },
    // Gleicher Name ausserhalb der Art: zählt nicht.
    { path: '/Lotus/Types/Items/ShipDecos/CetusScene', name: 'Cetus Scene' },
  ];

  it('Captura mit Rang', () => {
    const page = '{{SceneBox|C.png|Cetus|Cetus Scene|{{sc|25000}}|Yes|Purchased from {{Faction|Ostron}} offerings|Rank 5: Kin}}{{SceneBox|D.png|X|Unknown Scene||Yes|Unlocked by default|}}';
    assert.deepEqual(capturaSources(page, items), {
      found: { '/Lotus/Types/Items/MiscItems/PhotoboothTileCetusTown': [{ k: 'syndicate', t: 'Purchased from Ostron offerings (Rank 5: Kin)' }] },
      unmatched: ['Unknown Scene'],
    });
  });

  it('Tabellen: Erwerb aus der letzten Spalte, rowspan übernimmt die Zeile darüber, Beschreibungen fallen weg', () => {
    const page = [
      '{|',
      '! Syandana !! Flavor Text !! Acquisition',
      '|-',
      '|[[File:A.png]]<br>[[Abrasys Syandana]]',
      '|Flavor.',
      '| Purchaseable from the [[Market]] for {{pc|50}}.',
      '|-',
      '|[[Other Syandana]]',
      '|Shares the cell above.',
      '|}',
      '{|',
      '! Name !! Acquisition',
      '|-',
      '| [[Abrasys Syandana]] || Surrounds the character in a glow.',
      '|}',
    ].join('\n');
    assert.deepEqual(tableSources(page, items, [/^\/Lotus\/Upgrades\/Skins\/Scarves\//]).found, {
      '/Lotus/Upgrades/Skins/Scarves/ErosionCape': [{ k: 'market', t: 'Purchaseable from the Market for 50 Platinum.' }],
      '/Lotus/Upgrades/Skins/Scarves/OtherCape': [{ k: 'market', t: 'Purchaseable from the Market for 50 Platinum.' }],
    });
  });

  it('Sigils aus dem Lua-Modul; „Other“ nennt keinen Fundort', () => {
    const module = 'return {\n\t["Alad V Sigil"] = {\n\t\tName = "Alad V Sigil",\n\t\tLink = "Sigils#Enemy Drop Sigils",\n\t},\n\t["Odd Sigil"] = {\n\t\tName = "Odd Sigil",\n\t\tLink = "Sigils#Other Sigils"\n\t},\n}';
    assert.deepEqual(sigilSources(module, items), { found: { '/Lotus/Upgrades/Skins/Sigils/BossSigilAladV': [{ k: 'drop', t: 'Enemy drop' }] }, unmatched: [] });
  });

  it('Händler: Name aus `Link`, nur bei klarer Mehrheit der Angebote', () => {
    const module = [
      'return {',
      '\tVendors = {',
      '\t\t["Unearth Citrine"] = {',
      '\t\t\tLink = "Otak#Unearth_Citrine",',
      '\t\t\tName = "Unearth Citrine",',
      '\t\t\tOfferings = {',
      '\t\t\t\t{ "A", "Item", 1, 1 },',
      '\t\t\t\t{ "B", "Item", 1, 1 },',
      '\t\t\t\t{ "C", "Item", 1, 1 },',
      '\t\t\t\t-- { "D", "Item", 1, 1 },',
      '\t\t\t},',
      '\t\t},',
      '\t},',
      '}',
    ].join('\n');
    const names = new Map([['/Lotus/A', 'A'], ['/Lotus/B', 'B'], ['/Lotus/C', 'C'], ['/Lotus/D', 'D']]);
    const manifest = (items) => ({ items: items.map((path) => ({ storeItem: path.replace('/Lotus/', '/Lotus/StoreItems/') })) });
    const vendors = {
      '/Lotus/Types/Game/VendorManifests/Deimos/OtakLastWishManifest': manifest(['/Lotus/A', '/Lotus/B', '/Lotus/C']),
      // Nur zwei Treffer, oder nicht die Mehrheit: kein Name.
      '/Lotus/Types/Game/VendorManifests/Hubs/Small': manifest(['/Lotus/A', '/Lotus/B']),
      '/Lotus/Types/Game/VendorManifests/Hubs/Mixed': manifest(['/Lotus/A', '/Lotus/B', '/Lotus/C', '/Lotus/D', '/Lotus/X', '/Lotus/Y']),
    };
    assert.deepEqual(vendorNames(module, vendors, new Map([...names, ['/Lotus/X', 'X'], ['/Lotus/Y', 'Y']])), { 'Deimos/OtakLastWishManifest': 'Otak' });
  });
});

describe('Fehlende (#164)', () => {
  it('ohne Eintrag, mit Tag seit wann; ohne Namen zählt nicht', () => {
    const items = [
      { path: '/a', name: 'A' },
      { path: '/b', name: 'B' },
      { path: '/c', name: 'C' },
      { path: '/d', name: ' ' },
    ];
    const result = missingIn(items, new Set(['/a']), [{ path: '/b', name: 'B', since: '2026-10-01' }], '2026-11-07');
    assert.deepEqual(result, {
      total: 3,
      missing: [
        { path: '/b', name: 'B', since: '2026-10-01' },
        { path: '/c', name: 'C', since: '2026-11-07' },
      ],
    });
    const report = missingReport({ captura: result }, '2026-11-01');
    assert.match(report, /### captura \(1\)/);
    assert.match(report, /- C `\/c` \(since 2026-11-07\)/);
    assert.equal(missingReport({ captura: result }, '2026-12-01'), '');
  });
});
