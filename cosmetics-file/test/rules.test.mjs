// @ts-check
// #274: Muster für den Zustand von Kosmetik ohne Fundort und die Ausnahmen von Hand. Erfundene Teile nach dem Muster von
// public-export-plus (Pfad, englischer Name, Beschreibung, Pakete).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classify, exceptionFor, readExceptions } from '../lib/rules.mjs';

const SKINS = '/Lotus/Upgrades/Skins/';
const GLYPHS = '/Lotus/Types/StoreItems/AvatarImages/';
const PACKAGES = '/Lotus/Types/StoreItems/Packages/';

/** @param {string} path @param {string} name @param {{ description?: string, bundles?: string[] }} [more] */
const item = (path, name, more = {}) => ({ path, name, description: more.description ?? '', bundles: more.bundles ?? [] });
/** @param {Parameters<typeof item>} args */
const state = (...args) => {
  const found = classify(item(...args));
  return found && `${found.a}/${found.k}`;
};

describe('Muster (#274)', () => {
  it('kein Sammelstück: persönliche Legendary-Glyphen, Ranglisten- und gestrichene Embleme', () => {
    assert.equal(state(`${GLYPHS}AvatarImageGlyphExample`, 'Legendary Example Glyph'), 'never/personal');
    assert.equal(state(`${SKINS}Clan/LeaderBadgeExampleItem`, 'Example Leader Emblem'), 'never/cut');
    assert.equal(state(`${SKINS}Clan/ZawVariantBadgeItemA`, 'Example Emblem', { description: 'Awarded during the Tohtchi Variant.' }), 'never/cut');
    // Rollen-Embleme (Daves Entscheidung, Review S1): DE vergibt sie weiter an Leute in der Rolle, sonst kein Sammelstück.
    assert.equal(state(`${SKINS}Clan/ExampleBadgeItem`, 'Example Emblem', { description: 'A special emblem worn only by a select few Tenno.' }), 'never/special');
    assert.equal(state(`${SKINS}Clan/LotusGuideBadgeItem`, 'Example Mentor Emblem', { description: 'Awarded to Tenno who assist the Lotus by helping other Tenno.' }), 'never/special');
  });

  it('nur Konsole: Konsolen-Pakete, -Ordner und -Namen; geht vor Festen und Baro', () => {
    assert.equal(state(`${SKINS}Example/ExampleSkin`, 'Example Prestige Skin', { bundles: [`${PACKAGES}PrestigePackNine`] }), 'console/console');
    assert.equal(state(`${SKINS}Promo/Microsoft/ExampleSkin`, 'Example Skin'), 'console/console');
    assert.equal(state(`${SKINS}Example/OpalSkin`, 'Example Opal Skin', { bundles: [`${PACKAGES}WinterExampleBundle`] }), 'console/console');
    assert.equal(state(`${SKINS}Example/JadeSkin`, 'Braton Jade Skin'), 'console/console');
    assert.equal(state(`${GLYPHS}AvatarImageExcaliburActionSony`, 'Excalibur Example Glyph'), 'console/console');
    // Der Warframe Jade ist kein Konsolen-Paket.
    assert.equal(state(`${GLYPHS}AvatarImageJadeAccoladeGlyph`, 'Jade Accolade Glyph'), 'now/accolade');
    assert.equal(state(`${SKINS}Choir/JadeImmortalSkin`, 'Jade Immortal Skin'), undefined);
  });

  it('jederzeit: Accolade, Muster beim Brüten, Coda, Widersacher, Login', () => {
    assert.equal(state(`${GLYPHS}AvatarImageExampleAccoladeGlyph`, 'Example Accolade Glyph'), 'now/accolade');
    assert.equal(state('/Lotus/Types/Game/KubrowPet/Patterns/KubrowPetPatternZ', 'Example Fur Pattern'), 'now/genetic');
    // Mit Paket (Farbpaket) oder Eigenname kein Erbgut.
    assert.equal(state('/Lotus/Types/Game/KubrowPet/Patterns/KubrowPetPatternY', 'Bold Fur Pattern', { bundles: [`${PACKAGES}KubrowColorPackBold`] }), undefined);
    assert.equal(state('/Lotus/Types/Game/CatbrowPet/Patterns/CatbrowPetPatternVampire', 'Vasca Kavat Fur Pattern'), undefined);
    assert.equal(state('/Lotus/Types/Items/Emotes/DanceExample', 'Example Dance', { description: 'Smooth moves. Earned from a Technocyte Coda.' }), 'now/coda');
    assert.equal(state(`${SKINS}Clan/LichKillerBadgeItem`, 'Old Blood Emblem', { description: 'One who bested a Kuva Lich.' }), 'now/kuvaLich');
    assert.equal(state(`${SKINS}Clan/CorpusLichBadgeItem`, 'Sisterhood Emblem', { description: 'To honor the Sisters of Parvos.' }), 'now/sisters');
    assert.equal(state(`${GLYPHS}Login650Glyph`, 'Example Glyph'), 'now/tribute');
  });

  it('kommt wieder: Conquera, Moframe, Jubiläum, Baro, Feste, Dog Days', () => {
    assert.equal(state(`${SKINS}Armor/TnCharityRibbonArmor/ExampleRibbon`, 'Example Ribbon'), 'limited/conquera');
    assert.equal(state(`${SKINS}Mustache/ExampleMustache`, 'The Example'), 'limited/moframe');
    assert.equal(state(`${GLYPHS}ImageTwentyYearAnniversary`, 'Year Twenty Anniversary Glyph'), 'limited/anniversary');
    assert.equal(state(`${SKINS}Example/DexSkin`, 'Example Dex Skin'), 'limited/anniversary');
    assert.equal(state(`${SKINS}VoidTrader/ExampleSkin`, 'Braton Day of the Dead Skin'), 'limited/baro');
    assert.equal(state(`${SKINS}Armor/SetExample/LeftPrismaPlate`, 'Left Prisma Example Plates'), 'limited/baro');
    assert.equal(state(`${SKINS}Hoverboard/ExampleScrawl`, "BLUE KI'TEER EXAMPLE SCRAWL"), 'limited/baro');
    assert.equal(state(`${SKINS}Example/HalloweenSkin`, 'Example Skin', { bundles: [`${PACKAGES}HalloweenSkinPackZ`] }), 'limited/seasonal');
    assert.equal(state(`${SKINS}WinterSolstice/ExampleSkin`, 'Example Skin'), 'limited/seasonal');
    assert.equal(state(`${GLYPHS}AvatarImageDogDaysExample`, 'Community Dog Days Example Glyph'), 'limited/event');
  });

  it('nicht mehr erhältlich: Messen, Partner, Twitch, Werbung, zurückgezogen, vergangene Events', () => {
    assert.equal(state(`${GLYPHS}AvatarImageGamingCommunityExpoExample`, 'GCX 2030 Glyph'), 'gone/convention');
    assert.equal(state(`${SKINS}Nvidia/ExampleSkin`, 'Example Braton'), 'gone/partner');
    assert.equal(state(`${SKINS}Example/PhasedSkin`, 'Example Phased Skin'), 'gone/partner');
    assert.equal(state(`${SKINS}Promo/Twitch/ExampleSkin`, 'Example Iridos Skin'), 'gone/twitch');
    assert.equal(state(`${GLYPHS}ImageYouTubeExample`, 'Example Glyph'), 'gone/promo');
    assert.equal(state(`${SKINS}Clan/SkullBadgeExampleItem`, 'Example Skull Emblem', { description: 'Awarded on the retired Global Leaderboards.' }), 'gone/retired');
    assert.equal(state(`${SKINS}Clan/ExampleEventBadgeItem`, 'Example Emblem', { description: 'Awarded to Tenno who participated in the Example event.' }), 'gone/event');
    assert.equal(state(`${SKINS}Clan/ExampleOpBadgeItem`, 'Example Emblem', { description: 'For veterans of the Operation: Example.' }), 'gone/operation');
    assert.equal(state(`${SKINS}Clan/ExampleHuntBadgeItem`, 'Example Emblem', { description: 'An emblem awarded to all those who helped stop Example.' }), 'gone/event');
  });

  it('ohne passendes Muster kein Eintrag (nie „weg“ ohne Grund)', () => {
    assert.equal(state(`${SKINS}Example/ExampleSkin`, 'Example Skin', { description: 'A sleek skin.' }), undefined);
  });
});

describe('Ausnahmen von Hand (#274)', () => {
  const entry = { a: 'gone', k: 'promo', n: 'Example note', src: 'https://example.com/source', checked: '2026-11-15' };

  it('liest gültige Einträge, auch Ordner und `unknown`', () => {
    const read = readExceptions({ items: { [`${SKINS}Example/ExampleSkin`]: entry, [`${SKINS}Folder/`]: { ...entry, a: 'limited', k: 'seasonal' }, [`${SKINS}Wrong/WrongSkin`]: { a: 'unknown', n: 'Rule is wrong', src: 'https://example.com', checked: '2026-11-15' } } });
    assert.deepEqual(read[`${SKINS}Example/ExampleSkin`], entry);
    assert.equal(read[`${SKINS}Wrong/WrongSkin`]?.a, 'unknown');
    assert.equal(read[`${SKINS}Wrong/WrongSkin`]?.k, undefined);
  });

  it('bricht bei einem kaputten Eintrag ab, statt ihn wegzulassen', () => {
    assert.throws(() => readExceptions({}), /items/);
    assert.throws(() => readExceptions({ items: { 'Example/Skin': entry } }), /game path/);
    assert.throws(() => readExceptions({ items: { [`${SKINS}A`]: { ...entry, a: 'soon' } } }), /unknown state/);
    assert.throws(() => readExceptions({ items: { [`${SKINS}A`]: { ...entry, k: 'magic' } } }), /unknown kind/);
    assert.throws(() => readExceptions({ items: { [`${SKINS}A`]: { ...entry, src: 'wiki' } } }), /link/);
    assert.throws(() => readExceptions({ items: { [`${SKINS}A`]: { ...entry, checked: '15.11.2026' } } }), /day/);
    assert.throws(() => readExceptions({ items: { [`${SKINS}A`]: { ...entry, n: ' ' } } }), /note/);
  });

  it('Pfad vor Ordner, der längste Ordner gewinnt', () => {
    const exceptions = readExceptions({
      items: {
        [`${SKINS}Clan/`]: { ...entry, k: 'event' },
        [`${SKINS}Clan/Operation/`]: { ...entry, k: 'operation' },
        [`${SKINS}Clan/Operation/Special`]: { ...entry, a: 'never', k: 'cut' },
      },
    });
    assert.equal(exceptionFor(`${SKINS}Clan/OtherBadge`, exceptions)?.k, 'event');
    assert.equal(exceptionFor(`${SKINS}Clan/Operation/Badge`, exceptions)?.k, 'operation');
    assert.equal(exceptionFor(`${SKINS}Clan/Operation/Special`, exceptions)?.k, 'cut');
    assert.equal(exceptionFor(`${SKINS}Other/Badge`, exceptions), undefined);
  });
});
