// @ts-check
// #274: Bau der Statusdatei aus erfundenen kleinen Daten nach dem Muster von public-export-plus.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFiles, cosmeticsOf, FILES, flaggedText, newlyFlagged, outputLines, run, unknownReport } from '../build.mjs';
import { readExceptions } from '../lib/rules.mjs';

const SKINS = '/Lotus/Upgrades/Skins/';
const GLYPHS = '/Lotus/Types/StoreItems/AvatarImages/';
const DAY = Date.UTC(2026, 10, 18);

/** @param {Record<string, string>} names Pfad → englischer Name; der Schlüssel im dict ist `/Lotus/Language/<Pfad>`. */
function game(names = {}, extra = {}) {
  /** @type {Record<string, string>} */
  const dict = {};
  /** @type {Record<string, Record<string, unknown>>} */
  const customs = {};
  /** @type {Record<string, Record<string, unknown>>} */
  const flavour = {};
  for (const [path, name] of Object.entries(names)) {
    dict[`/Lotus/Language${path}`] = name;
    (path.startsWith(GLYPHS) ? flavour : customs)[path] = { name: `/Lotus/Language${path}`, excludeFromMarket: true };
  }
  return { customs, flavour, resources: {}, bundles: {}, vendors: {}, syndicates: {}, challenges: {}, emails: {}, dict, ...extra };
}

describe('cosmeticsOf (#274)', () => {
  it('zählt nur Sammelstücke mit Namen, ohne Standard-Teile und Teile, die es am PC nicht gibt', () => {
    const data = game({
      [`${SKINS}Example/CollectSkin`]: 'Collect Skin',
      [`${SKINS}Example/DefaultSkin`]: 'Default Skin',
      [`${SKINS}Example/ConsoleSkin`]: 'Console Skin',
      [`${SKINS}ChangYou/ChinaSkin`]: 'China Skin',
      [`${SKINS}RailJack/ExampleEngines`]: 'Example Engines MK II',
      [`${SKINS}Sentinels/Wings/ExampleWings`]: 'Example Wings',
      [`${SKINS}Sentinels/Wings/ExampleWingsRight`]: 'Example Wings',
      [`${GLYPHS}AvatarImageExample`]: 'Example Glyph',
    });
    data.customs[`${SKINS}Example/DefaultSkin`] = { ...data.customs[`${SKINS}Example/DefaultSkin`], alwaysAvailable: true };
    data.customs[`${SKINS}Example/ConsoleSkin`] = { ...data.customs[`${SKINS}Example/ConsoleSkin`], excludedPlatforms: ['CP_WINDOWS'] };
    data.customs[`${SKINS}Example/NamelessSkin`] = { name: '/Lotus/Language/Missing' };
    data.flavour['/Lotus/Types/StoreItems/SuitCustomizations/ColourPickerExampleA'] = { name: '/Lotus/Language/Palette' };
    data.bundles = { '/Lotus/Types/StoreItems/Packages/HalloweenExamplePack': { components: [{ typeName: `/Lotus/StoreItems/Upgrades/Skins/Example/CollectSkin` }] } };
    const items = cosmeticsOf(data);
    assert.deepEqual(
      items.map((entry) => entry.path),
      [`${GLYPHS}AvatarImageExample`, `${SKINS}Example/CollectSkin`, `${SKINS}Sentinels/Wings/ExampleWings`],
    );
    assert.deepEqual(items.find((entry) => entry.path.endsWith('CollectSkin'))?.bundles, ['/Lotus/Types/StoreItems/Packages/HalloweenExamplePack']);
  });
});

describe('buildFiles (#274)', () => {
  const exceptions = readExceptions({
    items: {
      [`${SKINS}Hand/`]: { a: 'gone', k: 'promo', n: 'Folder by hand', src: 'https://example.com', checked: '2026-11-15' },
      [`${SKINS}Example/MustacheSkin`]: { a: 'unknown', n: 'Rule is wrong here', src: 'https://example.com', checked: '2026-11-15' },
    },
  });
  /** @param {string} path @param {string} name */
  const cosmetic = (path, name, description = '') => ({ path, name, description, bundles: [] });
  const cosmetics = [
    cosmetic(`${SKINS}Mustache/TheExample`, 'The Example'),
    cosmetic(`${SKINS}Example/MustacheSkin`, 'Movember Skin'),
    cosmetic(`${SKINS}Hand/HandSkin`, 'Hand Skin'),
    cosmetic(`${SKINS}Example/KnownSkin`, 'Known Movember Skin'),
    cosmetic(`${SKINS}Example/OpenSkin`, 'Open Skin'),
    cosmetic('/Lotus/Types/StoreItems/SuitCustomizations/ColourPickerExampleA', 'Example Palette'),
  ];

  it('Ausnahmen vor Regeln, was die App kennt ohne Eintrag, Paletten nie; der Rest in der Liste ohne Zustand', () => {
    const built = buildFiles(cosmetics, new Set([`${SKINS}Example/KnownSkin`]), exceptions, {}, DAY);
    assert.deepEqual(built.availability.items, { [`${SKINS}Hand/`]: { a: 'gone', k: 'promo' }, [`${SKINS}Mustache/TheExample`]: { a: 'limited', k: 'moframe' } });
    assert.deepEqual(built.unknown.items, { [`${SKINS}Example/OpenSkin`]: { since: '2026-11-18', name: 'Open Skin' } });
    assert.equal(built.availability.asOf, '2026-11-18');
    assert.equal(built.availability.format, 'tennodock-cosmetics-availability');
  });

  it('`asOf` und `since` bleiben, solange sich nichts ändert', () => {
    const first = buildFiles(cosmetics, new Set(), exceptions, {}, DAY);
    const later = buildFiles(cosmetics, new Set(), exceptions, { availability: first.availability, unknown: first.unknown }, DAY + 7 * 86_400_000);
    assert.equal(later.availability.asOf, '2026-11-18');
    assert.equal(later.unknown.items[`${SKINS}Example/OpenSkin`]?.since, '2026-11-18');
    const changed = buildFiles([...cosmetics, cosmetic(`${SKINS}Mustache/TheSecond`, 'The Second')], new Set(), exceptions, { availability: first.availability }, DAY + 7 * 86_400_000);
    assert.equal(changed.availability.asOf, '2026-11-25');
  });
});

describe('run (#274)', () => {
  /** @returns {import('../build.mjs').Files & { data: Map<string, string> }} */
  const memory = (/** @type {Record<string, string>} */ start = {}) => {
    const data = new Map(Object.entries(start));
    return { data, read: async (path) => data.get(path), write: async (path, text) => void data.set(path, text) };
  };
  const minimum = { customs: 1, flavour: 0, resources: 0, bundles: 0, vendors: 0, syndicates: 0, challenges: 0, emails: 0, dict: 1, entries: 1 };
  const exceptions = { items: {} };
  const names = { [`${SKINS}Mustache/TheExample`]: 'The Example', [`${SKINS}Mustache/TheOther`]: 'The Other', [`${SKINS}Example/OpenSkin`]: 'Open Skin' };
  const repo = memory({ 'sources/v1/items.json': JSON.stringify({ items: {} }), 'palettes/v1/palettes.json': JSON.stringify({ palettes: {} }) });

  it('schreibt die Dateien einmal; ein zweiter Lauf ohne Änderung schreibt nichts', async () => {
    const files = memory();
    const log = (/** @type {string} */ _text) => {};
    const first = await run({ loadGame: async () => game(names), files, repo, exceptions, now: DAY, log, minimum });
    assert.deepEqual(first.written, [FILES.availability, FILES.unknown, FILES.sources]);
    assert.equal(first.entries, 2);
    assert.equal(first.unknown, 1);
    const second = await run({ loadGame: async () => game(names), files, repo, exceptions, now: DAY + 86_400_000, log, minimum });
    assert.deepEqual(second.written, []);
    assert.equal(JSON.parse(files.data.get(FILES.availability) ?? '{}').asOf, '2026-11-18');
  });

  it('lässt die Dateien stehen, wenn plus zu wenig liefert oder die Einträge einbrechen', async () => {
    const files = memory();
    /** @type {string[]} */
    const logs = [];
    const log = (/** @type {string} */ text) => void logs.push(text);
    await run({ loadGame: async () => game(names), files, repo, exceptions, now: DAY, log, minimum });
    const before = files.data.get(FILES.availability);
    const short = await run({ loadGame: async () => game({}), files, repo, exceptions, now: DAY, log, minimum });
    assert.equal(short.ok, false);
    assert.equal(files.data.get(FILES.availability), before);
    const dropped = await run({ loadGame: async () => game({ [`${SKINS}Example/OpenSkin`]: 'Open Skin', [`${SKINS}Other/Skin`]: 'Other Skin' }), files, repo, exceptions, now: DAY, log, minimum });
    assert.equal(dropped.ok, false);
    assert.equal(files.data.get(FILES.availability), before);
    assert.ok(logs.some((text) => text.startsWith('::warning::')));
  });

  it('bricht ab, wenn eine Ausnahme kaputt ist', async () => {
    await assert.rejects(run({ loadGame: async () => game(names), files: memory(), repo, exceptions: { items: { [`${SKINS}A`]: { a: 'gone' } } }, now: DAY, log: () => {}, minimum }), /exceptions\.json/);
  });
});

describe('Ausgaben (#274)', () => {
  it('prüft die Werte für den Commit streng', () => {
    assert.equal(outputLines({ written: [], asOf: '2026-11-18', entries: 566, unknown: 372, ok: true, flagged: [] }), 'asOf=2026-11-18\nentries=566\nunknown=372\n');
    assert.throws(() => outputLines({ written: [], asOf: '18.11.2026', entries: 1, unknown: 1, ok: true, flagged: [] }));
    assert.throws(() => outputLines({ written: [], asOf: '2026-11-18', entries: -1, unknown: 1, ok: true, flagged: [] }));
  });

  it('Bericht des Monats: nur neue Teile ohne Zustand', () => {
    const unknown = { format: 'tennodock-cosmetics-unknown', v: 1, asOf: '2026-11-18', items: { [`${SKINS}A`]: { since: '2026-10-01', name: 'Old' }, [`${SKINS}B`]: { since: '2026-11-04', name: 'New' } } };
    assert.match(unknownReport(unknown, '2026-11-01'), /New/);
    assert.doesNotMatch(unknownReport(unknown, '2026-11-01'), /Old/);
    assert.equal(unknownReport(unknown, '2026-12-01'), '');
  });
});

describe('Neue Einträge „weg“, „nur Konsole“, „kein Sammelstück“ (Review S2)', () => {
  const previous = { format: 'tennodock-cosmetics-availability', v: 1, asOf: '2026-11-18', items: { [`${SKINS}A`]: { a: 'gone', k: 'event' }, [`${SKINS}B`]: { a: 'limited', k: 'seasonal' } } };
  const names = new Map([[`${SKINS}B`, 'Bee Skin'], [`${SKINS}C`, 'Cee\nSkin']]);

  it('nennt nur, was gegenüber dem letzten Stand neu so heisst; ohne letzten Stand nichts', () => {
    /** @type {Record<string, import('../lib/rules.mjs').Availability>} */
    const items = { [`${SKINS}A`]: { a: 'gone', k: 'event' }, [`${SKINS}B`]: { a: 'gone', k: 'event' }, [`${SKINS}C`]: { a: 'never', k: 'special' }, [`${SKINS}D`]: { a: 'now', k: 'coda' }, [`${SKINS}Folder/`]: { a: 'console', k: 'console' } };
    assert.deepEqual(newlyFlagged(items, previous, names), [
      { path: `${SKINS}B`, name: 'Bee Skin', a: 'gone', k: 'event' },
      { path: `${SKINS}C`, name: 'Cee\nSkin', a: 'never', k: 'special' },
      { path: `${SKINS}Folder/`, name: `${SKINS}Folder/`, a: 'console', k: 'console' },
    ]);
    assert.deepEqual(newlyFlagged(items, undefined, names), []);
  });

  it('Commit-Meldung: eine Zeile pro Eintrag ohne Zeilenumbrüche im Namen, höchstens `limit`', () => {
    const flagged = [
      { path: `${SKINS}B`, name: 'Bee Skin', a: 'gone', k: 'event' },
      { path: `${SKINS}C`, name: 'Cee\nSkin', a: 'never', k: 'special' },
    ];
    const text = flaggedText(flagged);
    assert.match(text, /^New entries .*\(2\)/);
    assert.match(text, /- never\/special: Cee Skin \(/);
    assert.match(flaggedText(flagged, 1), /and 1 more/);
    assert.equal(flaggedText([]), '');
  });

  it('der Lauf schreibt sie als Notice ins Log und gibt sie zurück', async () => {
    const memory = () => {
      /** @type {Map<string, string>} */
      const data = new Map();
      return { data, read: async (/** @type {string} */ path) => data.get(path), write: async (/** @type {string} */ path, /** @type {string} */ text) => void data.set(path, text) };
    };
    const files = memory();
    const repo = memory();
    const minimum = { customs: 1, flavour: 0, resources: 0, bundles: 0, vendors: 0, syndicates: 0, challenges: 0, emails: 0, dict: 1, entries: 1 };
    /** @type {string[]} */
    const logs = [];
    const log = (/** @type {string} */ text) => void logs.push(text);
    const first = { [`${SKINS}Mustache/TheExample`]: 'The Example' };
    await run({ loadGame: async () => game(first), files, repo, exceptions: { items: {} }, now: DAY, log, minimum });
    assert.ok(logs.includes('First build: no earlier file to compare new entries with'));
    const data = game({ ...first, [`${SKINS}Clan/RoleBadgeItem`]: 'Role Emblem' });
    data.dict['/Lotus/Language/Desc'] = 'A special emblem worn only by a select few Tenno.';
    data.customs[`${SKINS}Clan/RoleBadgeItem`] = { ...data.customs[`${SKINS}Clan/RoleBadgeItem`], description: '/Lotus/Language/Desc' };
    const second = await run({ loadGame: async () => data, files, repo, exceptions: { items: {} }, now: DAY, log, minimum });
    assert.deepEqual(second.flagged, [{ path: `${SKINS}Clan/RoleBadgeItem`, name: 'Role Emblem', a: 'never', k: 'special' }]);
    assert.ok(logs.includes(`::notice::New never/special: Role Emblem (${SKINS}Clan/RoleBadgeItem)`));
  });
});
