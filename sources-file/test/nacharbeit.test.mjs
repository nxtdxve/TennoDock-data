// @ts-check
// #164 Nacharbeit: Regeln der App für missing.json, Prex-Karten und Sätze der Seite „Sigils“. Erfundene kleine Daten nach
// dem Muster von public-export-plus und des Wikis.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appSource, cosmeticRule, gameSources, isTennoGenPath, notOnPcByPath } from '../lib/covered.mjs';
import { prexPlaces, sigilPageSources } from '../lib/sources.mjs';

const SIGILS = '/Lotus/Upgrades/Skins/Sigils/';
const SCARVES = '/Lotus/Upgrades/Skins/Scarves/';

describe('Regeln der App (#164 Nacharbeit)', () => {
  const known = gameSources({
    customs: {
      [`${SCARVES}SWMarketScarf`]: { platinumCost: 105 },
      [`${SCARVES}ExcludedScarf`]: { platinumCost: 105, excludeFromMarket: true },
      [`${SCARVES}CreditScarf`]: { creditsCost: 5000 },
      [`${SIGILS}StandardSigil`]: { alwaysAvailable: true, platinumCost: 0, excludeFromMarket: true },
      [`${SCARVES}ConsoleScarf`]: { excludedPlatforms: ['CP_WINDOWS', 'CP_XBONE'], platinumCost: 90, excludeFromMarket: true },
      [`${SCARVES}PhoneOnlyNotScarf`]: { excludedPlatforms: ['CP_IOS'], excludeFromMarket: true },
      [`${SIGILS}NecramechSigil`]: { additionalItems: [`${SIGILS}NecramechSigil`, `${SIGILS}SnakeSigil`], excludeFromMarket: true },
    },
    resources: { '/Lotus/Types/Items/MiscItems/PhotoboothTileShop': { platinumCost: 50 } },
    bundles: {
      '/Lotus/Types/StoreItems/Packages/SceneBundle': { platinumCost: 300, components: [{ typeName: '/Lotus/StoreItems/Types/Items/MiscItems/PhotoboothTileBundle' }] },
      '/Lotus/Types/StoreItems/Packages/OldBundle': { platinumCost: 300, excludeFromMarket: true, components: [{ typeName: `/Lotus/StoreItems/Upgrades/Skins/Scarves/OldBundleScarf` }] },
      '/Lotus/Types/StoreItems/Packages/JadeShadowsSupporterPack': { excludeFromMarket: true, components: [{ typeName: `/Lotus/StoreItems/Upgrades/Skins/Sigils/JadeSigil` }] },
    },
    vendors: { '/Lotus/Types/Game/VendorManifests/Hubs/Example': { items: [{ storeItem: '/Lotus/StoreItems/Types/Items/MiscItems/PhotoboothTileVendor' }] } },
    syndicates: { ExampleSyndicate: { favours: [{ storeItem: `/Lotus/StoreItems/Upgrades/Skins/Sigils/SyndicateSigil` }] } },
    names: new Map(),
  });

  it('Markt wie `collectMarket`: Preis ohne `excludeFromMarket`, Credits zählen, Pakete nur mit Platin und ohne Ausschluss', () => {
    assert.equal(known.get(`${SCARVES}SWMarketScarf`), 'market');
    assert.equal(known.get(`${SCARVES}CreditScarf`), 'market');
    assert.equal(known.get('/Lotus/Types/Items/MiscItems/PhotoboothTileShop'), 'market');
    assert.equal(known.get('/Lotus/Types/Items/MiscItems/PhotoboothTileBundle'), 'market');
    assert.equal(known.has(`${SCARVES}ExcludedScarf`), false);
    assert.equal(known.has(`${SCARVES}OldBundleScarf`), false);
  });

  it('Händler, Syndikate, Standard-Teile, „Kommt mit“, am PC nicht erhältlich, Supporter Pack, ersetzt', () => {
    assert.equal(known.get('/Lotus/Types/Items/MiscItems/PhotoboothTileVendor'), 'vendor');
    assert.equal(known.get(`${SIGILS}SyndicateSigil`), 'syndicate');
    assert.equal(known.get(`${SIGILS}StandardSigil`), 'default');
    assert.equal(known.get(`${SCARVES}ConsoleScarf`), 'notOnPc');
    assert.equal(known.has(`${SCARVES}PhoneOnlyNotScarf`), false);
    assert.equal(known.get(`${SIGILS}SnakeSigil`), 'comesWith');
    assert.equal(known.has(`${SIGILS}NecramechSigil`), false, 'ein Teil kommt nicht mit sich selbst');
    assert.equal(known.get(`${SIGILS}JadeSigil`), 'supporterPack');
    assert.equal(known.get(`${SIGILS}MasterySigil`), 'replaced');
  });

  it('Regeln nach Name und Pfad wie `cosmeticRule` und `notOnPcByPath`', () => {
    assert.equal(cosmeticRule(`${SIGILS}TwitchPromoSigil`, 'Verv Sigil'), 'twitch');
    assert.equal(cosmeticRule('/Lotus/Upgrades/Skins/Effects/GaraPrimeEphemera', 'Catena Prime Ephemera'), 'primeAccess');
    assert.equal(cosmeticRule('/Lotus/Upgrades/Skins/Scarves/VTEosScarf', 'Eos Prime Syandana'), undefined, 'Baros Prime-Teile');
    assert.equal(cosmeticRule(`${SIGILS}ClanSigilBasic`, 'Clan Sigil'), 'clan');
    assert.equal(cosmeticRule(`${SIGILS}AllianceSigilBasic`, 'Alliance Sigil'), 'clan');
    assert.equal(cosmeticRule('/Lotus/Upgrades/Skins/Effects/Kuva/KuvaEphemeraA', 'Vengeful Flame Ephemera'), 'kuvaLich');
    assert.equal(cosmeticRule(`${SIGILS}FormaSigil`, 'Forma Sigil'), undefined);
    // Lunar Renewal (WeGame) gibt es am PC (Review M1).
    assert.equal(notOnPcByPath(`${SIGILS}WeGameNewYearSnakeSigil`), false);
    assert.equal(notOnPcByPath('/Lotus/Upgrades/Skins/Rhino/ChangYou/CYRhinoRubedoSkin'), true);
    // #274 (Review K3): China-Client auch mit Ziffer nach `CY`.
    assert.equal(notOnPcByPath('/Lotus/Upgrades/Skins/Clan/CY12345MediaBadge'), true);
    assert.equal(notOnPcByPath('/Lotus/Upgrades/Skins/Clan/CyclonBadge'), false);
    assert.equal(notOnPcByPath(`${SIGILS}PS4FirstYearSigil`), true);
    assert.equal(notOnPcByPath(`${SIGILS}CNYRoosterCYSigil`), false);
    assert.equal(appSource(`${SIGILS}WeGameNewYearSnakeSigil`, known, 'Lunar Renewal Snake Sigil'), undefined);
    assert.equal(appSource(`${SIGILS}PS4ThreeYearSigil`, known, 'Three Year Sigil'), 'notOnPc');
    assert.equal(appSource(`${SIGILS}FormaSigil`, known, 'Forma Sigil'), undefined);
  });

  it('ohne Dateien von plus: nur „ersetzt“, nichts sonst', () => {
    assert.deepEqual([...gameSources({ names: new Map() }).keys()], [`${SIGILS}MasterySigil`]);
  });
});

describe('Prex-Karten (#164 Nacharbeit)', () => {
  const CARDS = '/Lotus/Types/Lore/Fragments/LoreCardFragments/';
  const fragments = [
    { path: `${CARDS}AshLoreCardFragment`, name: 'Ash Prex' },
    { path: `${CARDS}RunnerLoreCardFragment`, name: 'Gauss Prex' },
    { path: `${CARDS}SiriusOrionLoreCardFragment`, name: 'Sirius & Orion Prex' },
    { path: '/Lotus/Types/Lore/Fragments/EarthFragmentA', name: 'Ash Prex' },
  ];
  const page = [
    '{{Table row/Prex|Ash|image=Prex8Ash.png|type=Warframe|source=Hidden pickup ([[Leverian]])|requirement=Not visible until you\'ve mastered {{WF|Ash}} / {{WF|Ash Prime|Prime}}}}',
    '{{Table row/Prex|Gauss|type=Warframe|source=Hidden pickup ([[Kronia Relay]], [[Saturn]])}}',
    '{{Table row/Prex|Sirius & Orion|type=Warframe|source=Hidden pickup ([[Pontis Tower]])}}',
    '{{Table row/Prex|Ember Heirloom|type=Heirloom|source=Marketplace}}',
  ].join('\n');

  it('Ort aus „Hidden pickup (…)“, mit Bedingung; nur Karten im Ordner `LoreCardFragments`', () => {
    const { found, unmatched } = prexPlaces(page, fragments);
    assert.deepEqual(found, {
      [`${CARDS}AshLoreCardFragment`]: 'Leverian, after mastering Ash',
      [`${CARDS}RunnerLoreCardFragment`]: 'Kronia Relay, Saturn',
      [`${CARDS}SiriusOrionLoreCardFragment`]: 'Pontis Tower',
    });
    assert.deepEqual(unmatched, ['Ember Heirloom']);
  });
});

describe('Seite „Sigils“ (#164 Nacharbeit)', () => {
  const items = [
    { path: `${SIGILS}FrozenSigil`, name: 'Glacium Sigil' },
    { path: `${SIGILS}HeirloomSigil`, name: 'Deca Heirloom Sigil' },
    { path: `${SIGILS}TranslatorSigil`, name: 'Tenno Translator Sigil' },
    { path: `${SIGILS}LotusGuideSigil`, name: 'Guide of the Lotus' },
    { path: `${SIGILS}VipSigil`, name: 'TennoVIP Example Sigil' },
    { path: `${SIGILS}XBoneJadeSigil`, name: 'Stoka Jade Sigil' },
    { path: `${SIGILS}LookSigil`, name: 'Look Sigil' },
  ];
  const page = [
    '==Purchasable Sigils==',
    '===Deluxe Sigils===',
    'These sigils, rather than being a single emblem on the chest or back, are full-body effects.',
    '',
    "The '''Glacium Sigil''' is available from [[Cephalon Melica]] at [[Yuvan Peak]] for '''250''' {{Resource|Entropic Kuva}}.",
    '{{SigilBox',
    '| mode        = stack',
    '| name        = Glacium Sigil',
    '}}',
    '',
    '===[[Heirloom Skins|Heirloom]] Sigils===',
    "The '''Deca Heirloom Sigil''' was part of the [[Risen Heirloom Collection]], sold for real-world currency for a limited time. These bundles have since been retired and are no longer available for purchase.",
    '{{SigilBox',
    '| name        = Deca Heirloom Sigil',
    '}}',
    '==Live Event Sigils==',
    'These exclusive Sigils were given to attendees of TennoLive, TennoVIP and TennoCon.',
    '{{SigilBox',
    '| name = TennoVIP Example Sigil',
    '}}',
    '==Other Sigils==',
    "The '''Tenno Translator Sigil''' was awarded to players who contributed with the translations of the game.",
    '{{SigilBox',
    '| name        = Tenno Translator Emblem',
    '}}',
    '',
    "The '''Guides of the Lotus Sigil''' was used to help new players. With the removal of the program, the Sigil is now unobtainable.",
    '{{SigilBox',
    '| name        = Guide of the Lotus',
    '}}',
    "A sigil that looks nice.",
    '{{SigilBox',
    '| name        = Look Sigil',
    '}}',
    '==Console-Exclusive Sigils==',
    '=== Xbox One Bundle Sigils ===',
    '{{SigilBox',
    '| name    = Stoka Jade Sigil',
    '| comment = XB1 Prestige Pack IX',
    '}}',
  ].join('\n');

  it('Satz vor dem Kasten, Art aus dem ganzen Satz; sonst Satz des Abschnitts oder Überschrift; Beschreibungen zählen nicht', () => {
    const { found } = sigilPageSources(page, items);
    assert.deepEqual(found[`${SIGILS}FrozenSigil`], [{ k: 'other', t: 'The Glacium Sigil is available from Cephalon Melica at Yuvan Peak for 250 Entropic Kuva.' }]);
    assert.equal(found[`${SIGILS}HeirloomSigil`]?.[0]?.k, 'unavailable');
    assert.equal(found[`${SIGILS}TranslatorSigil`]?.[0]?.t, 'The Tenno Translator Sigil was awarded to players who contributed with the translations of the game.');
    assert.equal(found[`${SIGILS}LotusGuideSigil`]?.[0]?.k, 'unavailable');
    assert.deepEqual(found[`${SIGILS}VipSigil`], [{ k: 'other', t: 'These exclusive Sigils were given to attendees of TennoLive, TennoVIP and TennoCon.' }]);
    assert.deepEqual(found[`${SIGILS}XBoneJadeSigil`], [{ k: 'unavailable', t: 'Xbox One Bundle' }]);
    assert.equal(found[`${SIGILS}LookSigil`], undefined, 'eine Beschreibung unter „Other“ ist kein Fundort');
  });
});

describe('Regeln der App seit #273', () => {
  const SKINS = '/Lotus/Upgrades/Skins/';
  const known = gameSources({
    customs: { [`${SKINS}Rhino/ArcaneHelmet`]: {}, [`${SKINS}Rhino/ArcaneHelmetStatless`]: {} },
    bundles: {
      '/Lotus/Types/StoreItems/Packages/ArmorPack': { excludeFromMarket: true, components: [{ typeName: `/Lotus/StoreItems/Upgrades/Skins/Armor/ArmorA` }, { typeName: '/Lotus/StoreItems/Types/Items/MiscItems/Res' }] },
      '/Lotus/Types/StoreItems/Packages/ScrawlPack': { packageDiscount: 0.2, components: [{ typeName: `/Lotus/StoreItems/Upgrades/Skins/Scarves/ScrawlScarf` }] },
      '/Lotus/Types/StoreItems/Packages/OldDeluxePack': { packageDiscount: 0.2, components: [{ typeName: `/Lotus/StoreItems/Upgrades/Skins/Scarves/DeluxeScarf` }] },
    },
    syndicates: {
      SteelMeridianSyndicate: { favours: [{ storeItem: '/Lotus/StoreItems/Types/StoreItems/Packages/ArmorPack' }] },
      RadioLegion2Syndicate: { titles: [{ reward: { ItemType: `/Lotus/StoreItems/Upgrades/Skins/Scarves/NightwaveScarf` } }] },
    },
    challenges: { '/Lotus/Types/Challenges/A': { countedRewards: [{ StoreItem: `/Lotus/StoreItems/Upgrades/Skins/Armor/TauMedal` }] } },
    emails: { '/Lotus/Types/Items/EmailItems/A': { message: { attachments: [`/Lotus/StoreItems/Upgrades/Skins/Sumdali/EyeOrnament`, '/Lotus/StoreItems/Types/Items/MiscItems/PhotoboothTileInbox'] } } },
    names: new Map(),
  });

  it('Pakete bei Syndikaten, Markt-Pakete ohne Preis (ohne Deluxe), Nightwave, Challenges, Inbox, Statless', () => {
    assert.equal(known.get(`${SKINS}Armor/ArmorA`), 'syndicate');
    assert.equal(known.has('/Lotus/Types/Items/MiscItems/Res'), false);
    assert.equal(known.get(`${SKINS}Scarves/ScrawlScarf`), 'bundle');
    assert.equal(known.has(`${SKINS}Scarves/DeluxeScarf`), false);
    assert.equal(known.get(`${SKINS}Scarves/NightwaveScarf`), 'nightwave');
    assert.equal(known.get(`${SKINS}Armor/TauMedal`), 'challenge');
    assert.equal(known.get(`${SKINS}Sumdali/EyeOrnament`), 'inbox');
    // Wie in der App nur Kosmetik (Review K3): Captura aus einer Nachricht zählt hier nicht.
    assert.equal(known.has('/Lotus/Types/Items/MiscItems/PhotoboothTileInbox'), false);
    assert.equal(known.get(`${SKINS}Rhino/ArcaneHelmet`), 'replaced');
    assert.equal(known.has(`${SKINS}Rhino/ArcaneHelmetStatless`), false);
  });

  it('TennoGen ohne Preis und Gründer-Embleme nach dem Pfad', () => {
    assert.equal(isTennoGenPath(`${SKINS}Scarves/SWCoronaScarf`), true);
    assert.equal(isTennoGenPath('/Lotus/Types/StoreItems/AvatarImages/SWGlyph'), false);
    assert.equal(appSource(`${SKINS}Scarves/SWCoronaScarf`, new Map(), 'Corona Syandana'), 'tennogen');
    assert.equal(cosmeticRule(`${SKINS}Clan/FoundersBadgeHunterItem`, 'Hunter Emblem'), 'founders');
  });
});

describe('Regeln der App für cosmetics-file (#274)', () => {
  const GLYPHS = '/Lotus/Types/StoreItems/AvatarImages/';

  it('Glyphen der Content-Creators und Emotes des Steel Path wie `cosmeticRule` in der App', () => {
    assert.equal(cosmeticRule(`${GLYPHS}FanChannel/ExampleCreatorGlyph`, 'Example Glyph'), 'creator');
    assert.equal(cosmeticRule(`${GLYPHS}AvatarImageCreatorExample`, 'Example Glyph'), 'creator');
    assert.equal(cosmeticRule('/Lotus/Types/Items/Emotes/HardmodeExampleEmote', 'Example Emote'), 'steelPath');
  });

  it('Markt aus `ExportFlavour` nur, wenn der Aufrufer die Datei mitgibt', () => {
    const flavour = { [`${GLYPHS}AvatarImageMarket`]: { platinumCost: 10 }, [`${GLYPHS}AvatarImageHidden`]: { platinumCost: 10, excludeFromMarket: true } };
    assert.equal(gameSources({ flavour, names: new Map() }).get(`${GLYPHS}AvatarImageMarket`), 'market');
    assert.equal(gameSources({ flavour, names: new Map() }).has(`${GLYPHS}AvatarImageHidden`), false);
    assert.equal(gameSources({ names: new Map() }).has(`${GLYPHS}AvatarImageMarket`), false);
  });
});
