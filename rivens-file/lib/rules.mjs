// @ts-check
// Regeln für die Riven-Preise (#172): Waffenart, Kernwerte und Klassen des Nachteils. Eine Kopie der Regeln der App
// (`src/modules/rivens/domain/fit-rules.ts`, #49 und #162); ein Test im App-Repo vergleicht beide über den Spiegel
// `tools/tennodock-data/`, damit sie nicht auseinanderlaufen. Doku: docs/pakete/172-riven-prices.md im App-Repo.

/** @typedef {'rifle' | 'shotgun' | 'pistol' | 'kitgun' | 'archgun' | 'melee' | 'zaw'} WeaponClass */

/** @type {readonly WeaponClass[]} */
export const WEAPON_CLASSES = ['rifle', 'shotgun', 'pistol', 'kitgun', 'archgun', 'melee', 'zaw'];

/** Riven-Typ pro Waffenart (DE-Export, `uniqueName`), für die Grundwerte. @type {Readonly<Record<WeaponClass, string>>} */
export const RIVEN_TYPES = {
  rifle: '/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare',
  shotgun: '/Lotus/Upgrades/Mods/Randomized/LotusShotgunRandomModRare',
  pistol: '/Lotus/Upgrades/Mods/Randomized/LotusPistolRandomModRare',
  kitgun: '/Lotus/Upgrades/Mods/Randomized/LotusModularPistolRandomModRare',
  archgun: '/Lotus/Upgrades/Mods/Randomized/LotusArchgunRandomModRare',
  melee: '/Lotus/Upgrades/Mods/Randomized/PlayerMeleeWeaponRandomModRare',
  zaw: '/Lotus/Upgrades/Mods/Randomized/LotusModularMeleeRandomModRare',
};

const CRIT = ['WeaponCritChanceMod', 'WeaponCritDamageMod'];
const PHYSICAL = ['WeaponImpactDamageMod', 'WeaponArmorPiercingDamageMod', 'WeaponSlashDamageMod'];
const GUN_FACTIONS = ['WeaponFactionDamageCorpus', 'WeaponFactionDamageGrineer', 'WeaponFactionDamageInfested'];
const MELEE_FACTIONS = ['WeaponMeleeFactionDamageCorpus', 'WeaponMeleeFactionDamageGrineer', 'WeaponMeleeFactionDamageInfested'];

const GUN_KEY = ['WeaponDamageAmountMod', 'WeaponFireIterationsMod', ...CRIT];
const MELEE_KEY = ['WeaponMeleeDamageMod', ...CRIT, 'WeaponFireRateMod'];
const GUN_HURTS = ['WeaponDamageAmountMod', 'WeaponFireIterationsMod', ...CRIT, 'WeaponFireRateMod', 'WeaponStunChanceMod', 'WeaponClipMaxMod', 'WeaponReloadSpeedMod'];
const GUN_HARMLESS = [...PHYSICAL, ...GUN_FACTIONS, 'WeaponProcTimeMod', 'WeaponAmmoMaxMod', 'WeaponProjectileSpeedMod', 'WeaponRecoilReductionMod', 'WeaponZoomFovMod'];
const MELEE_HURTS = [...CRIT, 'WeaponFireRateMod', 'WeaponStunChanceMod', 'WeaponMeleeRangeIncMod'];
const MELEE_HARMLESS = [
  ...PHYSICAL,
  ...MELEE_FACTIONS,
  'WeaponProcTimeMod',
  'ComboDurationMod',
  'WeaponMeleeComboPointsOnHitMod',
  'SlideAttackCritChanceMod',
  'WeaponMeleeFinisherDamageMod',
  'WeaponMeleeComboEfficiencyMod',
];

/** Kernwerte pro Waffenart (`key` in fit-rules.ts): Schrotflinten zählen Statuschance dazu. @type {Readonly<Record<WeaponClass, readonly string[]>>} */
export const KEY_STATS = {
  rifle: GUN_KEY,
  shotgun: [...GUN_KEY, 'WeaponStunChanceMod'],
  pistol: GUN_KEY,
  kitgun: GUN_KEY,
  archgun: GUN_KEY,
  melee: MELEE_KEY,
  zaw: MELEE_KEY,
};

/** Nachteile, die spürbar schaden (`hurts`); Archguns zusätzlich Munition. @type {Readonly<Record<WeaponClass, readonly string[]>>} */
export const HURTS = {
  rifle: GUN_HURTS,
  shotgun: GUN_HURTS,
  pistol: GUN_HURTS,
  kitgun: GUN_HURTS,
  archgun: [...GUN_HURTS, 'WeaponAmmoMaxMod'],
  melee: MELEE_HURTS,
  zaw: MELEE_HURTS,
};

/** Nachteile, die kaum etwas kosten (`harmless`). @type {Readonly<Record<WeaponClass, readonly string[]>>} */
export const HARMLESS = {
  rifle: GUN_HARMLESS,
  shotgun: GUN_HARMLESS,
  pistol: GUN_HARMLESS,
  kitgun: GUN_HARMLESS,
  archgun: GUN_HARMLESS.filter((tag) => tag !== 'WeaponAmmoMaxMod'),
  melee: MELEE_HARMLESS,
  zaw: MELEE_HARMLESS,
};

/**
 * Klasse des Nachteils als Buchstabe der Datei: `n` keiner, `h` harmlos, `s` schädlich. Unbekannt zählt vorsichtig als
 * schädlich, wie `curseFit` in der App.
 * @param {WeaponClass} weaponClass @param {string | undefined} tag @returns {'n' | 'h' | 's'}
 */
export function curseClass(weaponClass, tag) {
  if (tag === undefined) return 'n';
  if (HURTS[weaponClass].includes(tag)) return 's';
  return HARMLESS[weaponClass].includes(tag) ? 'h' : 's';
}

/** Alle Paare aus den Kernwerten, in der Reihenfolge der Liste (Gewehre 6, Schrotflinten 10). @param {WeaponClass} weaponClass @returns {[string, string][]} */
export function keyPairs(weaponClass) {
  const keys = KEY_STATS[weaponClass];
  /** @type {[string, string][]} */
  const pairs = [];
  for (let a = 0; a < keys.length; a++) for (let b = a + 1; b < keys.length; b++) pairs.push([/** @type {string} */ (keys[a]), /** @type {string} */ (keys[b])]);
  return pairs;
}

/** Nur zwei Paare für selten gehandelte Waffen: krit. Chance + krit. Schaden, Schaden + krit. Chance. @param {WeaponClass} weaponClass @returns {[string, string][]} */
export function rarePairs(weaponClass) {
  const damage = KEY_STATS[weaponClass][0] ?? 'WeaponDamageAmountMod';
  return [
    ['WeaponCritChanceMod', 'WeaponCritDamageMod'],
    [damage, 'WeaponCritChanceMod'],
  ];
}

/**
 * Nahkampf-Rivens tragen im Spiel eigene Tags für Schaden und Fraktionsschaden; warframe.market nennt für beide Waffenarten
 * den Tag der Schusswaffen (`base_damage_/_melee_damage` = `WeaponDamageAmountMod`). Geprüft am 08.11.2026 an DEs
 * `ExportUpgrades` (Riven-Typ `PlayerMeleeWeaponRandomModRare`) und `/v2/riven/attributes`.
 * @type {Readonly<Record<string, string>>}
 */
const MELEE_TAGS = {
  WeaponDamageAmountMod: 'WeaponMeleeDamageMod',
  WeaponFactionDamageCorpus: 'WeaponMeleeFactionDamageCorpus',
  WeaponFactionDamageGrineer: 'WeaponMeleeFactionDamageGrineer',
  WeaponFactionDamageInfested: 'WeaponMeleeFactionDamageInfested',
};

/** Tags, die nur im Spiel vorkommen (Nahkampf), für den Index der Datei. */
export const GAME_ONLY_TAGS = Object.values(MELEE_TAGS);

/** @param {WeaponClass} weaponClass */
const isMelee = (weaponClass) => weaponClass === 'melee' || weaponClass === 'zaw';

/** Tag von warframe.market → Tag wie im Spielstand. @param {WeaponClass} weaponClass @param {string} tag */
export function gameTag(weaponClass, tag) {
  return isMelee(weaponClass) && Object.hasOwn(MELEE_TAGS, tag) ? /** @type {string} */ (MELEE_TAGS[tag]) : tag;
}

/** Tag wie im Spielstand → Tag von warframe.market (für die Suche). @param {WeaponClass} weaponClass @param {string} tag */
export function marketTag(weaponClass, tag) {
  if (!isMelee(weaponClass)) return tag;
  return Object.entries(MELEE_TAGS).find(([, game]) => game === tag)?.[0] ?? tag;
}

/** Riven-Typ aus DEs Wochenwerten (`itemType`) → Waffenart. @type {Readonly<Record<string, WeaponClass>>} */
const CLASS_BY_ITEM_TYPE = {
  'Rifle Riven Mod': 'rifle',
  'Shotgun Riven Mod': 'shotgun',
  'Pistol Riven Mod': 'pistol',
  'Kitgun Riven Mod': 'kitgun',
  'Archgun Riven Mod': 'archgun',
  'Melee Riven Mod': 'melee',
  'Zaw Riven Mod': 'zaw',
};

/**
 * Waffenart einer Waffe: zuerst DEs Riven-Typ (genau), sonst aus Gruppe und `rivenType` von warframe.market. Dort heissen
 * Archguns `rifle` und Sekundär-Schrotflinten `shotgun`, im Spiel sind es Archgun- bzw. Pistolen-Rivens (W45/2026).
 * @param {{ group?: string, rivenType?: string }} weapon @param {string | undefined} deItemType @returns {WeaponClass | undefined}
 */
export function classOf(weapon, deItemType) {
  if (deItemType !== undefined && Object.hasOwn(CLASS_BY_ITEM_TYPE, deItemType)) return CLASS_BY_ITEM_TYPE[deItemType];
  const { group, rivenType } = weapon;
  if (group === 'archgun' || group === 'kitgun' || group === 'zaw' || group === 'melee') return group;
  if (group === 'secondary') return 'pistol';
  return WEAPON_CLASSES.find((entry) => entry === rivenType);
}
