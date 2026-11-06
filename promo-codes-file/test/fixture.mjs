// Erfundene Seite „Promo Codes“ in der Form des Wikis (#135), für die Tests von Parser und Action. Codes und Anlässe sind
// erfunden; die Form (Kopf, Zellen mit `|` und `||`, Links, Vorlagen, Einzelnachweise) folgt der echten Seite.

const inactiveRows = Array.from({ length: 20 }, (_, index) => `|-\n|OLDCODE${index}||Glyph||Old event||2020-01-01 to 2020-01-1${index % 10}||Old Glyph ${index}||`);

export const PAGE = [
  '{{UpdateMe|Add missing promo codes}}',
  "'''Promo Codes''' for [[WARFRAME]] can be entered in the in-game [[Market]].",
  '',
  '==Active Codes==',
  'List of active global codes.<ref>{{Ref|title=Free codes|url=https://example.com}}</ref>',
  '',
  '{| class="wikitable sortable"',
  '|-',
  '!style="min-width:15%"|Code!!Type!! Context!! Dates Active!!Reward(s)!!References',
  '|-',
  '|[https://warframe.com/promocode?code=SHINYGLYPH SHINYGLYPH]',
  '|Glyph',
  '|',
  '|',
  '|Shiny Example Glyph',
  '|',
  '|-',
  '|[https://warframe.com/promocode?code=EXAMPLE2026 EXAMPLE2026]',
  '|Glyph; Displays',
  '|[[Example (Event)|Example]] Year 2026',
  '|2026-07-01 to 2027-05-31',
  '|[[Glyph#Example|Example Lotus Glyph]], Example Frame [[Decorations/Orbiter Decorations#Other|Display]], Example {{WF|Qorvex}} Fusion [[Decorations|Display]]',
  '|',
  '|-',
  '|[https://www.warframe.com/en/promocode?code=BOOSTME BoostMe]',
  '|Booster;<br>Weapon',
  '|',
  '|2026-10-01 to ?',
  '|[[Affinity_Booster|3-day Affinity Booster]], {{Weapon|Zylok}}, and 220,000 {{Resource|Credits}}',
  '|<ref>{{Ref|title=x}}</ref>',
  '|-',
  '|PAIR-AAAAA<br>PAIR-BBBBB||Weapon||[[Example Quest]] promo||2026-09-01 to 2026-12-31||[[Nikana]], One-time 20% {{Resource|Platinum}} discount||',
  '|-',
  '|ENDED||Booster||Short stream||2026-10-01 to 2026-10-03||3 Day Credit Booster||',
  '|-',
  '|[https://warframe.com/promocode?code=r/warframe r/warframe]',
  '|Glyph',
  '|',
  '|',
  '|r/Warframe Icon Glyph',
  '|',
  '|-',
  '|[https://warframe.com/promocode?code=SHINYGLYPH shinyglyph]',
  '|Glyph',
  '|',
  '|',
  '|Duplicate',
  '|',
  '|}',
  '',
  '===Creator Glyph Promo Codes ===',
  '{{For|a list of active Creator Glyph promo codes|Glyph#Creator_Glyphs|}}',
  '',
  '== Inactive Codes ==',
  'If you try to redeem any of the expired codes, a message will pop up.',
  '{| class="wikitable sortable"',
  '|-',
  '!Code!!Type!!Context',
  '!Dates Active!!Reward(s)!!References',
  ...inactiveRows,
  '|}',
  '',
  '==References==',
  '{{Reflist}}',
].join('\n');

/** Antwort der API wie bei MediaWiki (`formatversion=2`). */
export const answer = (text = PAGE, revid = 2001, timestamp = '2026-11-02T18:28:15Z') =>
  JSON.stringify({
    batchcomplete: true,
    query: {
      pages: [
        {
          pageid: 9,
          title: 'Promo Codes',
          revisions: [
            {
              revid,
              parentid: 2000,
              timestamp,
              slots: { main: { contentmodel: 'wikitext', content: text } },
            },
          ],
        },
      ],
    },
  });

/** Erfundene Items in der Form von public-export-plus: Export-Datei und Wörterbuch. */
export const PLUS_EXPORT = {
  '/Lotus/Types/StoreItems/AvatarImages/ShinyExampleGlyph': {
    name: '/Lotus/Language/Shiny',
    icon: '/Lotus/Interface/Shiny.png',
  },
  '/Lotus/Types/StoreItems/AvatarImages/ExampleLotusGlyph': {
    name: '/Lotus/Language/ExampleLotus',
    icon: '/Lotus/Interface/Lotus.png',
  },
  '/Lotus/Types/Items/ShipDecos/ExampleFrameDisplay': {
    name: '/Lotus/Language/ExampleFrame',
    icon: '/Lotus/Interface/Frame.png',
  },
  '/Lotus/Types/StoreItems/Boosters/AffinityBooster3DayStoreItem': {
    name: '/Lotus/Language/Affinity3',
    icon: '/Lotus/Interface/Booster.png',
  },
  '/Lotus/Weapons/Tenno/Pistols/ConclaveLeverPistol/ConclaveLeverPistol': {
    name: '/Lotus/Language/Zylok',
    icon: '/Lotus/Interface/Zylok.png',
  },
  '/Lotus/Weapons/Tenno/Melee/Katana/Katana': {
    name: '/Lotus/Language/Nikana',
  },
  '/Lotus/Types/Recipes/Weapons/KatanaBlueprint': {
    name: '/Lotus/Language/Nikana',
  },
};
export const PLUS_DICT = {
  '/Lotus/Language/Shiny': 'Shiny Example Glyph',
  '/Lotus/Language/ExampleLotus': 'Example Lotus Glyph',
  '/Lotus/Language/ExampleFrame': 'Example Frame Display',
  '/Lotus/Language/Affinity3': '3 Day Affinity Booster',
  '/Lotus/Language/Zylok': 'Zylok',
  '/Lotus/Language/Nikana': 'Nikana',
};

/** Erfundener Index des DE-Exports (entpackt) mit allen genutzten Dateien und einer, die nicht zählt. */
export const DE_INDEX = [
  'ExportCustoms_en.json!00_customs1',
  'ExportDrones_en.json!00_drones1',
  'ExportFlavour_en.json!00_flavour1',
  'ExportGear_en.json!00_gear1',
  'ExportKeys_en.json!00_keys1',
  'ExportRegions_en.json!00_regions1',
  'ExportResources_en.json!00_resources1',
  'ExportSentinels_en.json!00_sentinels1',
  'ExportSortieRewards_en.json!00_sortie1',
  'ExportUpgrades_en.json!00_upgrades1',
  'ExportWarframes_en.json!00_warframes1',
  'ExportWeapons_en.json!00_weapons1',
  'ExportManifest.json!00_manifest1',
  '',
].join('\r\n');

/** Erfundene Items in der Form des DE-Exports (`uniqueName`, `name`, auch verschachtelt). */
export const DE_EXPORT = {
  ExportSortieRewards: { ExportNightwave: { rewards: [{ uniqueName: '/Lotus/Types/StoreItems/Boosters/AffinityBooster3DayStoreItem', name: '3 Day Affinity Booster' }] } },
  ExportFlavour: { ExportFlavour: [{ uniqueName: '/Lotus/Types/StoreItems/AvatarImages/ShinyExampleGlyph', name: 'Shiny Example Glyph' }] },
  ExportWeapons: {
    ExportWeapons: [
      { uniqueName: '/Lotus/Types/Recipes/Weapons/KatanaBlueprint', name: 'Nikana' },
      { uniqueName: '/Lotus/Weapons/Tenno/Melee/Katana/Katana', name: 'Nikana' },
      { uniqueName: '/Lotus/Weapons/Tenno/Pistols/ConclaveLeverPistol/ConclaveLeverPistol', name: 'Zylok' },
    ],
  },
};
