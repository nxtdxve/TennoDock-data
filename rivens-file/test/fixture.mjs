// Erfundene Antworten für die Tests der Riven-Preise (#172): drei Test-Waffen, ein kleiner Markt, DEs Wochenwerte und
// Grundwerte. Keine echten Auktionen, keine Verkäufer, keine Account-Daten.

import { displayValue, statValue } from '../lib/rolls.mjs';

const DAY_MS = 86_400_000;
export const NOW = Date.parse('2026-11-09T03:00:00Z');

export const WEAPONS = {
  apiVersion: '0.25.0',
  data: [
    { id: 'w1', slug: 'test_rifle', gameRef: '/Lotus/Weapons/Test/TestRifle', group: 'primary', rivenType: 'rifle', disposition: 1.2, i18n: { en: { name: 'Test Rifle' } } },
    { id: 'w2', slug: 'test_blade', gameRef: '/Lotus/Weapons/Test/TestBlade', group: 'melee', rivenType: 'melee', disposition: 1.2, i18n: { en: { name: 'Test Blade' } } },
    { id: 'w3', slug: 'test_pistol', gameRef: '/Lotus/Weapons/Test/TestPistol', group: 'secondary', rivenType: 'pistol', disposition: 1.2, i18n: { en: { name: 'Test Pistol' } } },
  ],
  error: null,
};

/** Slug → Tag wie bei warframe.market (Nahkampf-Schaden heisst dort wie bei Schusswaffen). */
export const SLUGS = {
  critical_chance: 'WeaponCritChanceMod',
  critical_damage: 'WeaponCritDamageMod',
  multishot: 'WeaponFireIterationsMod',
  'base_damage_/_melee_damage': 'WeaponDamageAmountMod',
  'fire_rate_/_attack_speed': 'WeaponFireRateMod',
  toxin_damage: 'WeaponToxinDamageMod',
  zoom: 'WeaponZoomFovMod',
  recoil: 'WeaponRecoilReductionMod',
  status_chance: 'WeaponStunChanceMod',
  damage_vs_corpus: 'WeaponFactionDamageCorpus',
};
const SLUG_OF = Object.fromEntries(Object.entries(SLUGS).map(([slug, tag]) => [tag, slug]));

export const ATTRIBUTES = { apiVersion: '0.25.0', data: Object.entries(SLUGS).map(([slug, gameRef], index) => ({ id: `a${index}`, slug, gameRef, group: 'default', prefix: 'x', suffix: 'y' })), error: null };

/** Erfundene Grundwerte (Grössenordnung wie im Spiel). */
export const BASE = {
  rifle: {
    WeaponCritChanceMod: [0.1, 'p'],
    WeaponCritDamageMod: [0.08, 'p'],
    WeaponFireIterationsMod: [0.06, 'p'],
    WeaponDamageAmountMod: [0.165, 'p'],
    WeaponToxinDamageMod: [0.09, 'p'],
    WeaponZoomFovMod: [0.0592, 'p'],
    WeaponRecoilReductionMod: [-0.09, 'p'],
  },
  melee: { WeaponMeleeDamageMod: [0.1648, 'p'], WeaponCritChanceMod: [0.18, 'p'], WeaponCritDamageMod: [0.09, 'p'], WeaponFireRateMod: [0.055, 'p'] },
  pistol: { WeaponCritChanceMod: [0.15, 'p'], WeaponCritDamageMod: [0.09, 'p'], WeaponDamageAmountMod: [0.22, 'p'] },
};

/** Angezeigter Wert wie im Spiel bei Rang 8, auf eine Stelle gerundet. */
export function shown(weaponClass, tag, buffs, curses, curse, roll) {
  const stat = BASE[weaponClass][tag];
  const value = statValue(stat[0], { rank: 8, buffs, curses, curse }, roll) ?? 0;
  return Math.round(displayValue(stat, value) * 10) / 10;
}

/** Kleiner fester Zufall (mulberry32). */
export function random(seed) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POLARITIES = ['madurai', 'naramon', 'vazarin'];

/**
 * Eine Auktion wie bei warframe.market, mit Verkäufer und Notiz (die der Parser nie übernimmt). Werte nach Tag, ein Tag
 * mit Minus ist der Nachteil. Im Markt heisst Nahkampf-Schaden wie bei Schusswaffen.
 */
export function auction(id, price, weaponClass, buffs, curse, options = {}) {
  const rand = random(id.length * 7919 + [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0));
  const curses = curse ? 1 : 0;
  const slugOf = (tag) => SLUG_OF[tag === 'WeaponMeleeDamageMod' ? 'WeaponDamageAmountMod' : tag];
  const roll = options.roll;
  return {
    id,
    buyout_price: price,
    starting_price: price,
    top_bid: null,
    is_direct_sell: true,
    closed: options.closed ?? false,
    visible: options.visible ?? true,
    private: false,
    note: 'erfundene Notiz',
    created: new Date(options.updated ?? NOW - DAY_MS).toISOString(),
    updated: new Date(options.updated ?? NOW - (1 + Math.floor(rand() * 10)) * DAY_MS).toISOString(),
    owner: { ingame_name: 'ErfundenerSpieler', id: 'owner1', status: 'ingame', reputation: 5 },
    item: {
      type: 'riven',
      weapon_url_name: options.weapon ?? 'test_rifle',
      name: 'test',
      mod_rank: 8,
      mastery_level: 10,
      re_rolls: 5,
      polarity: options.polarity ?? POLARITIES[Math.floor(rand() * 3)],
      attributes: [
        ...buffs.map((tag) => ({ url_name: slugOf(tag), value: shown(weaponClass, tag, buffs.length, curses, false, roll ?? rand()), positive: true })),
        ...(curse ? [{ url_name: slugOf(curse), value: shown(weaponClass, curse, buffs.length, curses, true, roll ?? rand()), positive: false }] : []),
      ],
    },
  };
}

/** Antwort der Suche. */
export const auctionsAnswer = (auctions) => JSON.stringify({ payload: { auctions } });

/**
 * Markt der Tests: Test Rifle mit 150 Angeboten für krit. Chance + krit. Schaden (die erste Suche ist voll, je Polarität
 * nicht) und 10 für Schaden + Mehrfachschuss; Test Blade 6 Angebote (Nahkampf-Schaden); Test Pistol 3.
 */
export function market() {
  const rifle = [];
  const CC = 'WeaponCritChanceMod';
  const CD = 'WeaponCritDamageMod';
  const MS = 'WeaponFireIterationsMod';
  for (let i = 0; i < 60; i++) rifle.push(auction(`r-ccms-${i}`, 800 + i * 10, 'rifle', [CC, CD, MS], 'WeaponZoomFovMod', { polarity: POLARITIES[i % 3], roll: (i % 20) / 19 }));
  for (let i = 0; i < 30; i++) rifle.push(auction(`r-cc-${i}`, 400 + i * 5, 'rifle', [CC, CD], undefined, { polarity: POLARITIES[i % 3] }));
  for (let i = 0; i < 20; i++) rifle.push(auction(`r-tox-${i}`, 300 + i * 5, 'rifle', [CC, CD, 'WeaponToxinDamageMod'], 'WeaponDamageAmountMod', { polarity: POLARITIES[i % 3] }));
  for (let i = 0; i < 36; i++) rifle.push(auction(`r-old-${i}`, 100, 'rifle', [CC, CD], undefined, { polarity: POLARITIES[i % 3], updated: Date.parse('2026-10-01T00:00:00Z') }));
  rifle.push(auction('r-joke', 99999, 'rifle', [CC, CD], undefined, { polarity: 'madurai' }));
  rifle.push(auction('r-closed', 10, 'rifle', [CC, CD], undefined, { polarity: 'madurai', closed: true }));
  rifle.push(auction('r-hidden', 10, 'rifle', [CC, CD], undefined, { polarity: 'naramon', visible: false }));
  for (let i = 0; i < 10; i++) rifle.push(auction(`r-dms-${i}`, 150 + i, 'rifle', ['WeaponDamageAmountMod', MS], 'WeaponRecoilReductionMod', { polarity: POLARITIES[i % 3] }));
  const blade = [];
  for (let i = 0; i < 6; i++) blade.push(auction(`b-${i}`, 90 + i * 10, 'melee', ['WeaponMeleeDamageMod', CC, CD], undefined, { weapon: 'test_blade' }));
  const pistol = [];
  for (let i = 0; i < 3; i++) pistol.push(auction(`p-${i}`, 20 + i, 'pistol', [CC, CD], undefined, { weapon: 'test_pistol' }));
  return { test_rifle: rifle, test_blade: blade, test_pistol: pistol };
}

/** Suche im erfundenen Markt wie bei warframe.market: enthält alle Vorteile, Polarität, Sortierung, höchstens 100. */
export function searchMarket(pool, url) {
  const params = new URL(url).searchParams;
  const positive = (params.get('positive_stats') ?? '').split(',').filter(Boolean);
  const polarity = params.get('polarity');
  const desc = params.get('sort_by') === 'price_desc';
  const list = (pool[params.get('weapon_url_name') ?? ''] ?? [])
    .filter((entry) => positive.every((slug) => entry.item.attributes.some((attribute) => attribute.positive && attribute.url_name === slug)))
    .filter((entry) => !polarity || entry.item.polarity === polarity)
    .sort((a, b) => (desc ? b.buyout_price - a.buyout_price : a.buyout_price - b.buyout_price))
    .slice(0, 100);
  return auctionsAnswer(list);
}

/**
 * DEs Wochenwerte: die drei Test-Waffen und 200 Füllzeilen (sonst gilt die Datei als zu klein). Wie bei DE ein
 * JavaScript-Objekt (Schlüssel ohne Anführungszeichen, Texte in einfachen), dazu ein Komma am Ende.
 */
export function weeklyText() {
  const rows = [
    { itemType: 'Rifle Riven Mod', compatibility: null, rerolled: false, avg: 10, stddev: 1, min: 5, max: 20, pop: 1, median: 9 },
    { itemType: 'Rifle Riven Mod', compatibility: 'Test Rifle', rerolled: true, avg: 400, stddev: 200, min: 50, max: 4000, pop: 100, median: 300 },
    { itemType: 'Rifle Riven Mod', compatibility: 'Test Rifle', rerolled: false, avg: 50, stddev: 20, min: 10, max: 200, pop: 80, median: 40.4 },
    { itemType: 'Melee Riven Mod', compatibility: 'Test Blade', rerolled: true, avg: 100, stddev: 50, min: 20, max: 300, pop: 3, median: 90 },
    { itemType: 'Pistol Riven Mod', compatibility: 'Test Pistol', rerolled: false, avg: 16, stddev: 4, min: 5, max: 30, pop: 1, median: 7.25 },
  ];
  for (let i = 0; i < 200; i++) rows.push({ itemType: 'Rifle Riven Mod', compatibility: `Filler ${i}`, rerolled: true, avg: 25, stddev: 5, min: 10, max: 40, pop: 1, median: 20 });
  const json = `${JSON.stringify(rows, null, 1).slice(0, -2)},\n]`;
  return json.replace(/"(\w+)":/g, '$1:').replace(/"([^"]*)"/g, "'$1'");
}
