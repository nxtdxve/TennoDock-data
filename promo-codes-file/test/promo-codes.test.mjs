// Parser der Seite „Promo Codes“ (#135) gegen die erfundene Seite in der Form des Wikis.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clean, codesIn, isoDay, isPlaceholderCell, MAX_REWARDS, MAX_TEXT, noCodeReason, parseDates, parsePromoPage, parseTable, rewardParts, shorten } from '../lib/promo-codes.mjs';
import { PAGE } from './fixture.mjs';

describe('clean', () => {
  it('macht Links, Vorlagen und Umbrüche zu Text, ohne Einzelnachweise und Kommentare', () => {
    assert.equal(clean('[[Glyph#A|Lotus Glyph]], {{Weapon|Zylok}}<ref>{{Ref|x}}</ref><!-- x -->'), 'Lotus Glyph, Zylok');
    assert.equal(clean('500 {{Resource|Orokin Ducats}}<br>{{Resource|Riven Sliver|Riven Slivers}}'), '500 Orokin Ducats\nRiven Slivers');
    assert.equal(clean("[https://warframe.com/promocode?code=X '''X''']"), 'X');
  });
});

describe('codesIn', () => {
  it('Code aus Link und Adresse, jeder einmal; auch mit `/` und mehrere pro Zelle', () => {
    assert.deepEqual(codesIn('[https://warframe.com/promocode?code=SHINY Shiny]'), ['SHINY']);
    assert.deepEqual(codesIn('[https://warframe.com/promocode?code=r/warframe r/warframe]'), ['r/warframe']);
    assert.deepEqual(codesIn('PAIR-AAAAA<br>PAIR-BBBBB'), ['PAIR-AAAAA', 'PAIR-BBBBB']);
  });

  it('was kein Code sein kann, fällt weg', () => {
    assert.deepEqual(codesIn('DUVIRI-(Warframe name)'), []);
    assert.deepEqual(codesIn(''), []);
  });
});

describe('Daten', () => {
  it('Beginn und Ende nur aus Bereichen; ein einzelnes Datum zählt nicht', () => {
    assert.deepEqual(parseDates('2026-07-01 to 2027-05-31'), {
      from: '2026-07-01',
      until: '2027-05-31',
    });
    assert.deepEqual(parseDates('2026-10-01 to Indefinite'), {
      from: '2026-10-01',
    });
    assert.deepEqual(parseDates('2026-11-02 to ?'), { from: '2026-11-02' });
    assert.deepEqual(parseDates('2021-06-16 - 2021-08-21'), {
      from: '2021-06-16',
      until: '2021-08-21',
    });
    assert.deepEqual(parseDates('August 26, 2022 to August 28, 2022'), {
      from: '2022-08-26',
      until: '2022-08-28',
    });
    assert.deepEqual(parseDates('Expired January 1, 2019'), {
      until: '2019-01-01',
    });
    assert.deepEqual(parseDates('2025-12-25'), {});
    assert.deepEqual(parseDates(''), {});
  });

  it('ein Ende vor dem Beginn gilt nicht (Tippfehler im Wiki)', () => {
    assert.deepEqual(parseDates('2026-11-20 to 2026-11-10'), {});
  });

  it('nur echte Tage', () => {
    assert.equal(isoDay('2026-02-30'), undefined);
    assert.equal(isoDay('Smarch 1, 2026'), undefined);
  });
});

describe('rewardParts', () => {
  it('trennt an Zeilen, Kommas, „and“ und „;“, nicht in Zahlen', () => {
    assert.deepEqual(rewardParts('[[Affinity_Booster|3-day Affinity Booster]], {{Weapon|Zylok}}, and 220,000 {{Resource|Credits}}'), ['3-day Affinity Booster', 'Zylok', '220,000 Credits']);
    assert.deepEqual(rewardParts('Adds Golden Hand decoration'), ['Golden Hand decoration']);
    assert.deepEqual(rewardParts('Alpha<br>Beta; Gamma.'), ['Alpha', 'Beta', 'Gamma']);
  });
});

describe('parseTable', () => {
  it('Zellen mit `|` und `||`, Attribute im Kopf, Fortsetzung auf der nächsten Zeile', () => {
    const table = parseTable(['{| class="wikitable"', '|-', '!style="x"|Code!!Reward(s)', '|-', '|A||one', '|-', '|B', '|', 'two', '|}'].join('\n'));
    assert.deepEqual(table?.header, ['Code', 'Reward(s)']);
    assert.deepEqual(table?.rows, [
      ['A', 'one'],
      ['B', '\ntwo'],
    ]);
  });
});

describe('parsePromoPage', () => {
  it('aktive Zeilen mit Codes, Anlass, Daten und Belohnungen; die Spalten über den Namen', () => {
    const { active, inactive } = parsePromoPage(PAGE);
    assert.equal(inactive.length, 20);
    assert.equal(active.length, 7);
    assert.deepEqual(active[1], {
      codes: ['EXAMPLE2026'],
      context: 'Example Year 2026',
      from: '2026-07-01',
      until: '2027-05-31',
      rewards: ['Example Lotus Glyph', 'Example Frame Display', 'Example Qorvex Fusion Display'],
    });
    assert.deepEqual(active[2]?.codes, ['BOOSTME']);
    assert.deepEqual(active[3]?.codes, ['PAIR-AAAAA', 'PAIR-BBBBB']);
  });

  it('Platzhalter: „TBA“ und Ähnliches sind kein Code; leere Zelle ja, unlesbare Vorlage nein', () => {
    assert.deepEqual(codesIn('TBA'), []);
    assert.deepEqual(codesIn('None<br>REALCODE'), ['REALCODE']);
    assert.equal(isPlaceholderCell('TBA'), true);
    assert.equal(isPlaceholderCell('n/a'), true);
    assert.equal(isPlaceholderCell(' '), true);
    assert.equal(isPlaceholderCell('{{PromoCode|X}}'), false);
    assert.equal(isPlaceholderCell('REALCODE'), false);
  });

  it('Grund ohne Code: Platzhalter, Beschreibung (Leerzeichen, Klammern) oder nicht lesbar', () => {
    assert.equal(noCodeReason('TBA'), 'placeholder');
    assert.equal(noCodeReason('DUVIRI-(Warframe name)'), 'description');
    assert.equal(noCodeReason('{{PromoCode|X}}'), 'unreadable');
    assert.equal(noCodeReason('CODE#1'), 'unreadable');
  });

  it('kürzt lange Texte und begrenzt die Zahl der Belohnungen', () => {
    assert.equal(shorten('x'.repeat(MAX_TEXT + 30)).length, MAX_TEXT);
    assert.ok(shorten('x'.repeat(MAX_TEXT + 30)).endsWith('…'));
    assert.equal(shorten('short'), 'short');
    assert.equal(rewardParts(Array.from({ length: MAX_REWARDS + 5 }, (_, index) => `Reward ${index}`).join('<br>')).length, MAX_REWARDS);
  });

  it('scheitert ohne Abschnitt, Tabelle oder bekannte Spalten', () => {
    assert.throws(() => parsePromoPage('==Active Codes==\nx'), /No table under "Active Codes"/);
    assert.throws(() => parsePromoPage(PAGE.replace('== Inactive Codes ==', '== Old ==')), /No section "Inactive Codes"/);
    assert.throws(() => parsePromoPage(PAGE.replace('Reward(s)!!References', 'Prize!!References')), /Unexpected columns/);
  });
});
