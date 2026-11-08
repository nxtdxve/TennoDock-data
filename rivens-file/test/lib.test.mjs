// Reine Funktionen der Riven-Preise (#172) ohne Netz: Regeln, Würfelglück, Spannen, Suche, DEs Wochenwerte, Plan, Datei.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFile, checkFile, encodeFile, readFile, readState } from '../lib/file.mjs';
import { pairKey, planRun, slotOf, tierOf } from '../lib/plan.mjs';
import { offerLuck, readBaseValues, rollFromShown, statQuality } from '../lib/rolls.mjs';
import { classOf, curseClass, gameTag, KEY_STATS, keyPairs, marketTag, rarePairs } from '../lib/rules.mjs';
import { buildEntry, isFresh, percentile, priceRange, roundPlatinum, weaponEntries, withoutOutliers } from '../lib/stats.mjs';
import { looseJson, readWeekly, weeklyEntry } from '../lib/weekly.mjs';
import { parseAttributes, parseAuctionPage, parseAuctions, parseWeapons, searchPair, searchUrl } from '../lib/wfm.mjs';
import { ATTRIBUTES, auction, auctionsAnswer, BASE, market, NOW, searchMarket, shown, WEAPONS, weeklyText } from './fixture.mjs';

const DAY_MS = 86_400_000;

describe('rules', () => {
  it('Paare der Kernwerte: Gewehre 6, Schrotflinten 10, seltene Waffen 2', () => {
    assert.equal(keyPairs('rifle').length, 6);
    assert.equal(keyPairs('shotgun').length, 10);
    assert.equal(keyPairs('melee').length, 6);
    assert.deepEqual(rarePairs('melee'), [['WeaponCritChanceMod', 'WeaponCritDamageMod'], ['WeaponMeleeDamageMod', 'WeaponCritChanceMod']]);
    assert.ok(KEY_STATS.shotgun.includes('WeaponStunChanceMod'));
  });
  it('Klasse des Nachteils: keiner, harmlos, schädlich; unbekannt schädlich; Archgun-Munition schadet', () => {
    assert.equal(curseClass('rifle', undefined), 'n');
    assert.equal(curseClass('rifle', 'WeaponZoomFovMod'), 'h');
    assert.equal(curseClass('rifle', 'WeaponDamageAmountMod'), 's');
    assert.equal(curseClass('rifle', 'WeaponNewMod'), 's');
    assert.equal(curseClass('rifle', 'WeaponAmmoMaxMod'), 'h');
    assert.equal(curseClass('archgun', 'WeaponAmmoMaxMod'), 's');
  });
  it('Waffenart aus DEs Riven-Typ, sonst aus Gruppe und Riven-Typ von warframe.market', () => {
    assert.equal(classOf({ group: 'archgun', rivenType: 'rifle' }, undefined), 'archgun');
    assert.equal(classOf({ group: 'secondary', rivenType: 'shotgun' }, undefined), 'pistol');
    assert.equal(classOf({ group: 'primary', rivenType: 'rifle' }, 'Shotgun Riven Mod'), 'shotgun');
    assert.equal(classOf({ group: 'sentinel', rivenType: 'melee' }, undefined), 'melee');
    assert.equal(classOf({ group: 'other' }, undefined), undefined);
  });
  it('Nahkampf: Schaden und Fraktionsschaden mit eigenen Tags im Spiel', () => {
    assert.equal(gameTag('melee', 'WeaponDamageAmountMod'), 'WeaponMeleeDamageMod');
    assert.equal(gameTag('zaw', 'WeaponFactionDamageCorpus'), 'WeaponMeleeFactionDamageCorpus');
    assert.equal(gameTag('rifle', 'WeaponDamageAmountMod'), 'WeaponDamageAmountMod');
    assert.equal(marketTag('melee', 'WeaponMeleeDamageMod'), 'WeaponDamageAmountMod');
    assert.equal(marketTag('melee', 'WeaponCritChanceMod'), 'WeaponCritChanceMod');
  });
});

describe('rolls', () => {
  it('liest Grundwerte und Einheit aus ExportUpgrades, nur den ersten Wert', () => {
    const json = {
      ExportUpgrades: [
        { uniqueName: '/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare', upgradeEntries: [
          { tag: 'WeaponCritChanceMod', upgradeValues: [{ value: 0.1, locTag: '|val|% Critical Chance' }, { value: 0.2 }] },
          { tag: 'WeaponFactionDamageCorpus', upgradeValues: [{ value: 0.45, locTag: 'x|val| Damage to Corpus' }] },
          { tag: 'WeaponAmmoEfficiency', upgradeValues: [{ value: -0.1, locTag: '|val|% Ammo Efficiency', reverseValueSymbol: true }] },
          { tag: 'Broken', upgradeValues: [{ locTag: 'x' }] },
        ] },
        { uniqueName: '/Lotus/Upgrades/Mods/Randomized/RawRifleRandomMod' },
      ],
    };
    assert.deepEqual(readBaseValues(json), { rifle: { WeaponCritChanceMod: [0.1, 'p'], WeaponFactionDamageCorpus: [0.45, 'm'], WeaponAmmoEfficiency: [-0.1, 'p', 1] } });
    assert.deepEqual(readBaseValues({}), {});
  });
  it('Würfel aus der Anzeige zurück; ein Wert, der nicht passt, ist unbekannt', () => {
    const stat = BASE.rifle.WeaponCritChanceMod;
    const value = shown('rifle', 'WeaponCritChanceMod', 2, 0, false, 0.75);
    const roll = rollFromShown(stat, { rank: 8, buffs: 2, curses: 0, curse: false }, value);
    assert.ok(roll && roll.min <= 0.75 && roll.max >= 0.75);
    assert.equal(rollFromShown(stat, { rank: 8, buffs: 2, curses: 0, curse: false }, 1), undefined);
  });
  it('Glück fremder Werte: Rang 0 mit Wert bei Rang 0 oder bei Rang 8; Nachteil umgekehrt', () => {
    const stat = BASE.rifle.WeaponCritChanceMod;
    const atMax = shown('rifle', 'WeaponCritChanceMod', 2, 0, false, 0.9);
    assert.ok(Math.abs((statQuality(stat, { buffs: 2, curses: 0, curse: false }, 0, atMax) ?? 0) - 0.9) < 0.02);
    const atZero = Math.round(atMax / 9 * 10) / 10;
    assert.ok(Math.abs((statQuality(stat, { buffs: 2, curses: 0, curse: false }, 0, atZero) ?? 0) - 0.9) < 0.1);
    const curse = shown('rifle', 'WeaponZoomFovMod', 2, 1, true, 0.2);
    assert.ok(Math.abs((statQuality(BASE.rifle.WeaponZoomFovMod, { buffs: 2, curses: 1, curse: true }, 8, curse) ?? 0) - 0.8) < 0.02);
  });
  it('Glück eines Angebots ist das Mittel der lesbaren Werte; eine unbekannte Eigenschaft zählt für die Form', () => {
    const values = [
      { tag: 'WeaponCritChanceMod', value: shown('rifle', 'WeaponCritChanceMod', 3, 0, false, 0.6), positive: true },
      { tag: 'WeaponCritDamageMod', value: shown('rifle', 'WeaponCritDamageMod', 3, 0, false, 0.8), positive: true },
      { tag: 'WeaponUnknown', value: 5, positive: true },
    ];
    assert.ok(Math.abs((offerLuck(values, BASE.rifle, 8) ?? 0) - 0.7) < 0.02);
    assert.equal(offerLuck(values, undefined, 8), undefined);
  });
});

describe('stats', () => {
  it('Perzentil, Rundung, Spanne wie in der App', () => {
    assert.equal(percentile([10, 20, 30, 40], 0.5), 25);
    assert.equal(percentile([], 0.5), undefined);
    assert.deepEqual([99.4, 101, 1234, 12_340].map(roundPlatinum), [99, 100, 1230, 12_350]);
    assert.deepEqual(priceRange([100, 120, 140, 160, 180, 200, 220, 240]), [135, 185]);
  });
  it('Witzpreise weg, nie unter dem doppelten Median; unter 4 bleibt alles', () => {
    const offers = [100, 110, 120, 130, 140, 99999].map((price) => ({ price }));
    assert.equal(withoutOutliers(offers).length, 5);
    assert.equal(withoutOutliers([50, 50, 50, 50, 50, 50, 50, 60, 70].map((price) => ({ price }))).length, 9);
    assert.equal(withoutOutliers([{ price: 1 }, { price: 99999 }]).length, 2);
  });
  it('frisch: seit 22.10.2026, höchstens 60 Tage, Zukunft bis einen Tag', () => {
    assert.equal(isFresh(Date.parse('2026-10-21T23:00:00Z'), NOW), false);
    assert.equal(isFresh(Date.parse('2026-10-22T00:00:00Z'), NOW), true);
    assert.equal(isFresh(NOW + 2 * DAY_MS, NOW), false);
    assert.equal(isFresh(Date.parse('2026-10-25T00:00:00Z'), Date.parse('2027-01-01T00:00:00Z')), false);
  });
  it('Eintrag: unter 5 nichts, 5 bis 7 ohne Verteilung, ab 8 mit p10/Median/p90, unvollständig markiert', () => {
    const offers = (n) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, price: 100 + i * 10, buffs: [], updated: NOW }));
    assert.equal(buildEntry(offers(4), false), undefined);
    assert.deepEqual(buildEntry(offers(5), false), [110, 125, 5]);
    assert.deepEqual(buildEntry(offers(8), false), [120, 140, 8, [105, 135, 165]]);
    assert.deepEqual(buildEntry(offers(5), true), [110, 125, 5, 0, 1]);
  });
  it('Glücks-Fenster ab 16 Angeboten, wenn ein Fenster 8 hat; God Rolls fallen nicht als Witzpreise weg', () => {
    const cheap = Array.from({ length: 32 }, (_, i) => ({ id: `c${i}`, price: 100 + i, buffs: [], updated: NOW, luck: 0.3 }));
    const god = Array.from({ length: 8 }, (_, i) => ({ id: `g${i}`, price: 1000 + i * 20, buffs: [], updated: NOW, luck: 0.95 }));
    const entry = buildEntry([...cheap, ...god], false);
    assert.ok(entry && entry[5]);
    assert.deepEqual(entry[5]['9'], [1040, 1080, 8]);
    assert.equal(entry[5]['3'][2], 32);
    assert.equal(entry[5]['7'], undefined);
  });
  it('Einträge einer Waffe: Stufe 1 genau, Stufe 2 mit Stern, vollständig nur über ein vollständiges Paar', () => {
    const tags = ['A', 'B', 'C', 'D'];
    const indexOf = (tag) => tags.indexOf(tag);
    const offer = (id, buffs, curse, price) => ({ id, price, buffs: [...buffs].sort(), ...(curse ? { curse } : {}), updated: NOW });
    const offers = [
      ...Array.from({ length: 6 }, (_, i) => offer(`x${i}`, ['A', 'B', 'C'], 'D', 200 + i)),
      ...Array.from({ length: 5 }, (_, i) => offer(`y${i}`, ['A', 'B'], undefined, 100 + i)),
      ...Array.from({ length: 5 }, (_, i) => offer(`z${i}`, ['A', 'C'], undefined, 50 + i)),
    ];
    const entries = weaponEntries(offers, [{ pair: ['A', 'B'], complete: false }, { pair: ['A', 'C'], complete: true }], (tag) => (tag ? 'h' : 'n'), indexOf);
    assert.deepEqual(Object.keys(entries), ['*0.1|h', '*0.2|h', '0.1.2|h', '0.1|n', '0.2|n']);
    assert.equal(entries['0.1.2|h'][4], undefined, 'über A+C vollständig');
    assert.equal(entries['*0.1|h'][4], 1, 'A+B war unvollständig');
    assert.equal(entries['0.1|n'][4], 1);
  });
});

describe('wfm', () => {
  it('liest Waffen und Eigenschaften', () => {
    const weapons = parseWeapons(JSON.stringify(WEAPONS));
    assert.deepEqual(weapons?.[0], { slug: 'test_rifle', path: 'Weapons/Test/TestRifle', name: 'Test Rifle', group: 'primary', rivenType: 'rifle' });
    assert.equal(parseAttributes(JSON.stringify(ATTRIBUTES))?.get('critical_chance'), 'WeaponCritChanceMod');
    assert.equal(parseWeapons(JSON.stringify({ data: [] })), undefined);
  });
  it('Auktionen ohne Verkäufer und Notiz; geschlossene, unsichtbare und ohne Sofortkauf fallen weg', () => {
    const list = parseAuctions(auctionsAnswer([
      auction('a1', 500, 'rifle', ['WeaponCritChanceMod', 'WeaponCritDamageMod']),
      auction('a2', 500, 'rifle', ['WeaponCritChanceMod', 'WeaponCritDamageMod'], undefined, { closed: true }),
      auction('a3', 500, 'rifle', ['WeaponCritChanceMod', 'WeaponCritDamageMod'], undefined, { visible: false }),
      { ...auction('a4', 500, 'rifle', ['WeaponCritChanceMod', 'WeaponCritDamageMod']), buyout_price: null },
    ]));
    assert.equal(list?.length, 1);
    assert.deepEqual(Object.keys(list?.[0] ?? {}).sort(), ['id', 'price', 'rank', 'updated', 'values']);
    assert.ok(!JSON.stringify(list).includes('ErfundenerSpieler'));
    assert.ok(!JSON.stringify(list).includes('Notiz'));
    assert.equal(parseAuctions('{"payload":{}}'), undefined);
  });
  it('Adresse der Suche', () => {
    assert.equal(searchUrl('test_rifle', ['critical_chance', 'critical_damage'], { polarity: 'madurai', desc: true }), 'https://api.warframe.market/v1/auctions/search?type=riven&weapon_url_name=test_rifle&positive_stats=critical_chance,critical_damage&polarity=madurai&sort_by=price_desc');
  });
  it('Paar-Suche: unter 100 eine Suche; bei 100 je Polarität; bekannt volle gleich geteilt', async () => {
    const pool = market();
    const urls = [];
    const search = async (url) => {
      urls.push(url);
      return parseAuctionPage(searchMarket(pool, url)) ?? { failed: 'error' };
    };
    const small = await searchPair(search, 'test_rifle', ['base_damage_/_melee_damage', 'multishot'], false);
    assert.ok(!('failed' in small) && small.complete && !small.big && small.auctions.length === 10);
    assert.equal(urls.length, 1);
    urls.length = 0;
    const full = await searchPair(search, 'test_rifle', ['critical_chance', 'critical_damage'], false);
    assert.ok(!('failed' in full) && full.complete && full.big);
    assert.equal(urls.length, 4);
    assert.equal(full.auctions.length, 147, 'ohne geschlossene und unsichtbare');
    urls.length = 0;
    await searchPair(search, 'test_rifle', ['critical_chance', 'critical_damage'], true);
    assert.equal(urls.length, 3);
  });
  it('Paar-Suche: volle Teile ohne Überschneidung sind unvollständig; Fehler gibt das Paar auf', async () => {
    const many = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, price: i, values: [] }));
    let call = 0;
    const search = async (url) => ({ list: url.includes('price_desc') ? many(`d${call++}-`, 100) : many(`a${call++}-`, 100), total: 100 });
    const answer = await searchPair(search, 'w', ['a', 'b'], true);
    assert.ok(!('failed' in answer) && !answer.complete);
    const failing = await searchPair(async () => ({ failed: 'error' }), 'w', ['a', 'b'], false);
    assert.deepEqual(failing, { failed: 'error' });
  });
});

describe('weekly', () => {
  it('liest DEs Format mit BOM und Komma am Ende; Median und Beliebtheit pro Waffe; Typ-Zeilen fallen weg', () => {
    const weekly = readWeekly(`﻿${weeklyText()}`);
    assert.deepEqual(weekly.get('test rifle'), { itemType: 'Rifle Riven Mod', rolled: { median: 300, pop: 100 }, unrolled: { median: 40.4, pop: 80 } });
    assert.equal(weekly.size, 203);
    assert.deepEqual(weeklyEntry(weekly.get('test rifle')), [300, 100, 40, 80]);
    assert.deepEqual(weeklyEntry(weekly.get('test pistol')), [null, null, 7.3, 1]);
    assert.equal(weeklyEntry(undefined), undefined);
  });
  it('wandelt ein JavaScript-Objekt in JSON: Schlüssel, einfache Anführungszeichen, Escapes, Kommentare, NaN', () => {
    const text = String.raw`[{a: 'It\'s "x"', b: -NaN, c: [1, 2,], // k
 d: true, /* c */ e: 'a\nb', f: null},]`;
    assert.deepEqual(JSON.parse(looseJson(text)), [{ a: `It's "x"`, b: null, c: [1, 2], d: true, e: 'a\nb', f: null }]);
    assert.throws(() => looseJson('[{a: undefined}]'), /unexpected undefined/);
    assert.throws(() => looseJson("['open"), /open string/);
  });
  it('liest Zahlen mit Exponent und mit Punkt am Anfang (Review K3)', () => {
    assert.deepEqual(JSON.parse(looseJson('[{a: 1e-7, b: 2.5E+3, c: -4, d: .5, e: 12}]')), [{ a: 1e-7, b: 2500, c: -4, d: 0.5, e: 12 }]);
  });
  it('zu wenige Zeilen oder kein JSON: Fehler', () => {
    assert.throws(() => readWeekly('[]'), /only 0 rows/);
    assert.throws(() => readWeekly('<html>'));
  });
});

describe('plan', () => {
  const weapon = (slug, pop, lastAt, big) => ({ slug, path: `P/${slug}`, weaponClass: 'rifle', ...(pop !== undefined ? { pop } : {}), ...(lastAt ? { lastAt } : {}), ...(big ? { big } : {}) });
  it('Stufen nach Beliebtheit; ohne DE-Wert nach vollen Paaren', () => {
    assert.equal(tierOf(weapon('a', 100)), 'A');
    assert.equal(tierOf(weapon('a', 2)), 'B');
    assert.equal(tierOf(weapon('a', 1)), 'C');
    assert.equal(tierOf(weapon('a', undefined, undefined, ['x'])), 'A');
    assert.equal(tierOf(weapon('a')), 'C');
  });
  it('fester Tag pro Waffe; heute gesucht nie, nie gesucht immer', () => {
    assert.equal(slotOf('test_rifle', 3), slotOf('test_rifle', 3));
    const today = new Date(NOW).toISOString().slice(0, 10);
    const planned = planRun([weapon('a', 100, today), weapon('b', 100)], NOW);
    assert.deepEqual(planned.map((entry) => entry.weapon.slug), ['b']);
    assert.equal(planned[0]?.pairs.length, 6);
    assert.equal(planned[0]?.estimate, 6);
  });
  it('Tag in der Runde vor Überfälligen; überfällig erst nach Runde plus einem Tag; volle Paare zählen dreifach', () => {
    const day = Math.floor(NOW / DAY_MS);
    const slugs = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8'];
    const slotToday = slugs.find((slug) => slotOf(slug, 3) === day % 3);
    const notToday = slugs.find((slug) => slotOf(slug, 3) !== day % 3);
    const twoDays = new Date(NOW - 2 * DAY_MS).toISOString().slice(0, 10);
    const fiveDays = new Date(NOW - 5 * DAY_MS).toISOString().slice(0, 10);
    const planned = planRun([weapon(notToday, 100, fiveDays), weapon(slotToday, 100, twoDays, [pairKey(['WeaponCritChanceMod', 'WeaponCritDamageMod'])]), weapon('fresh', 100, twoDays)].filter((entry) => entry.slug !== 'fresh' || slotOf('fresh', 3) !== day % 3), NOW);
    assert.deepEqual(planned.map((entry) => entry.weapon.slug), [slotToday, notToday]);
    assert.equal(planned[0]?.estimate, 8);
  });
});

describe('file', () => {
  const file = buildFile({ asOf: '2026-11-09', now: NOW, deAt: '2026-11-09', stats: ['A', 'B', 'C'], weapons: { 'X/Y': { at: '2026-11-09', de: [10, 1, null, null], pairs: ['0.1', '0.2!'], c: { '0.1|n': [10, 20, 5], '*0.1|h': [30, 40, 8, [25, 35, 50]] } }, 'X/Empty': {} } });
  it('baut, prüft und liest die Datei; Waffen ohne Inhalt fallen weg', () => {
    assert.deepEqual(Object.keys(file.weapons), ['X/Y']);
    assert.deepEqual(checkFile(file), []);
    const text = encodeFile(file);
    assert.deepEqual(readFile(text), JSON.parse(text));
    assert.equal(readFile(text)?.weapons['X/Y']?.c?.['0.1|n']?.[2], 5);
    assert.equal(readFile('{"format":"other"}'), undefined);
    assert.equal(readFile('kaputt'), undefined);
  });
  it('findet Fehler: Index ausserhalb, tief über hoch, zu wenige, falscher Schlüssel', () => {
    const bad = buildFile({ asOf: '2026-11-09', now: NOW, stats: ['A'], weapons: { 'X/Y': { at: '2026-11-09', pairs: ['0.5'], c: { '0.1|n': [30, 20, 5], '0.0|x': [1, 2, 3] } } } });
    assert.equal(checkFile(bad).length, 5);
  });
  it('Merkzettel: kaputte Teile fallen weg', () => {
    assert.deepEqual(readState('{"weapons":[{"slug":"a","path":"b","name":"c"},{"slug":1}],"big":{"x":["a+b"],"y":[1]},"base":{"rifle":{"T":[1,"p"]}}}'), { v: 1, weapons: [{ slug: 'a', path: 'b', name: 'c' }], big: { x: ['a+b'] }, base: { rifle: { T: [1, 'p'] } } });
    assert.deepEqual(readState('kaputt'), { v: 1 });
  });
  it('Merkzettel: Tageszähler und Hash von DEs Datei; kaputte fallen weg', () => {
    assert.deepEqual(readState('{"day":{"date":"2026-11-09","searches":12},"de":{"hash":"ab","changedAt":"2026-11-02"}}'), { v: 1, day: { date: '2026-11-09', searches: 12 }, de: { hash: 'ab', changedAt: '2026-11-02' } });
    assert.deepEqual(readState('{"day":{"date":"gestern","searches":-1},"de":{"hash":1}}'), { v: 1 });
  });
});
