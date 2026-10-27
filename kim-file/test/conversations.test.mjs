// Wahlstellen, Chemie, Merker und Bedingungen aus dem Gesprächsgraphen (#106), mit der erfundenen Datei aus fixture.mjs.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanText, conversations, personOf, rankOf, shorten } from '../lib/conversations.mjs';
import { DICT, GROUP, TESTA } from './fixture.mjs';

const text = (tag) => (tag === undefined ? undefined : cleanText(DICT[tag]));

describe('conversations', () => {
  const convos = conversations(TESTA, text);

  it('liest die Gespräche ohne Geburtstagsgrüsse; Stellen mit nur einer Antwort sind keine Wahl', () => {
    assert.deepEqual(Object.keys(convos).sort(), ['TestaRank2Convo1', 'TestaRank3Convo1', 'TestaSpecial']);
    assert.deepEqual(convos['TestaSpecial'], { first: 'hey there', c: [] });
  });

  it('nennt Rang, erste Nachricht und Wahlstellen in der Reihenfolge des Gesprächs', () => {
    const convo = convos['TestaRank2Convo1'];
    assert.equal(convo.r, 2);
    assert.equal(convo.first, 'hey there');
    assert.deepEqual(convo.c.map((c) => c.p), ['hey there', 'What next?', 'Cats?']);
  });

  it('summiert die Chemie bis zur nächsten Wahl, bei Zweigen höchster und niedrigster Wert', () => {
    const [first, second] = convos['TestaRank2Convo1'].c;
    assert.deepEqual(first.a, [{ t: 'Sure.', c: 10 }, { t: 'No.', f: 'n' }]);
    // Antwort ohne Text im Wörterbuch: nur die Zahlen; danach 20 oder 5 je nach Merker.
    assert.deepEqual(second.a, [{ t: 'A' }, { c: 20, m: 5 }]);
  });

  it('markiert Antworten, die eine Romanze beginnen oder ausschliessen', () => {
    const third = convos['TestaRank2Convo1'].c[2];
    assert.deepEqual(third.a, [{ t: 'Yes', f: 'd' }, { t: 'Nope' }]);
  });

  it('nennt, nach welchen Antworten eine Wahlstelle kommt', () => {
    const [first, second, third] = convos['TestaRank2Convo1'].c;
    assert.equal(first.af, undefined);
    assert.deepEqual(second.af, [0, [0]]);
    assert.deepEqual(third.af, [1, [0]]);
  });

  it('nennt Merker aus früheren Gesprächen, nicht aber eigene', () => {
    assert.deepEqual(convos['TestaRank2Convo1'].c[2].if, ['TestaLikesCats', true]);
    const own = convos['TestaRank3Convo1'];
    assert.equal(own.c[1].if, undefined);
    assert.deepEqual(own.c[1].af, [0, [0]]);
  });

  it('sucht die Nachricht vor einer Wahl rückwärts, wenn die Wahlstelle selbst keine ist', () => {
    assert.equal(convos['TestaRank3Convo1'].c[0].p, 'Old line');
    assert.equal(convos['TestaRank3Convo1'].r, 3);
  });

  it('liefert nichts für Dateien ohne Chemie und für Unlesbares', () => {
    assert.deepEqual(conversations(GROUP, text), {});
    assert.deepEqual(conversations('kaputt', text), {});
    assert.deepEqual(conversations([null, 3], text), {});
  });
});

describe('Hilfen', () => {
  it('rankOf liest den Rang aus der Kennung', () => {
    assert.equal(rankOf('AmirRank5Convo7'), 5);
    assert.equal(rankOf('MinVelRank1Convo2'), 1);
    assert.equal(rankOf('RoatheStory3'), undefined);
  });

  it('cleanText entfernt Marken und doppelten Leerraum', () => {
    assert.equal(cleanText('a <RETRO_EMOJI_WINK> b\n c'), 'a b c');
    assert.equal(cleanText('<RETRO_EMOJI_HEART>'), undefined);
    assert.equal(cleanText(42), undefined);
  });

  it('shorten kürzt am Wortende', () => {
    assert.equal(shorten('one two three four', 12), 'one two…');
    assert.equal(shorten('short', 12), 'short');
    assert.equal(shorten(undefined), undefined);
  });

  it('personOf liest die Person aus dem Dateinamen', () => {
    assert.equal(personOf('JabirDialogue_rom.dialogue.json'), 'Jabir');
    assert.equal(personOf('MinervaVelemirDialogue_rom.dialogue.json'), 'MinervaVelemir');
    assert.equal(personOf('README.md'), undefined);
  });
});
