// Parser der Creator-Glyphen-Codes (#122) mit erfundenen Einträgen in der Form des Wikis (fixture.mjs).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseGlyphCodes, wikiSection } from '../lib/glyph-codes.mjs';
import { SECTION } from './fixture.mjs';

describe('wikiSection', () => {
  const page = ['Intro', '==Normal==', 'a', '==Creator Glyphs==', 'one', '===Community Glyphs===', 'two', '== Legendary Glyphs ==', 'three'].join('\n');

  it('nimmt den Abschnitt mit Unterabschnitten bis zur nächsten Überschrift derselben Ebene', () => {
    assert.equal(wikiSection(page, 'Creator Glyphs'), '==Creator Glyphs==\none\n===Community Glyphs===\ntwo');
  });

  it('liest Überschriften mit Leerzeichen und Unterabschnitte bis zum Ende', () => {
    assert.equal(wikiSection(page, 'Legendary Glyphs'), '== Legendary Glyphs ==\nthree');
    assert.equal(wikiSection(page, 'Community Glyphs'), '===Community Glyphs===\ntwo');
  });

  it('ohne Überschrift undefined', () => {
    assert.equal(wikiSection(page, 'Creator'), undefined);
  });
});

describe('parseGlyphCodes', () => {
  const entries = parseGlyphCodes(SECTION);

  it('liest Code, Bild und Namen; fehlt der dritte Wert, ist der zweite der Code', () => {
    assert.deepEqual(entries[0], { code: 'NightOwl', image: 'NightOwlGlyphW7.png' });
    assert.deepEqual(entries[1], { code: 'OWLCODE', image: 'Owl2Glyph.png', name: 'OwlTwo' });
    assert.deepEqual(entries[4], { code: 'NAMEDCODE', image: 'NamedGlyph.png', name: 'Named' });
    assert.deepEqual(entries[5], { code: 'r/warframe', image: 'Reddit.png' });
  });

  it('liest Vorlagen über mehrere Zeilen mit Links und Vorlagen im vierten Wert', () => {
    assert.deepEqual(entries[3], { code: 'MANYLINES', image: 'ManyLinesGlyph.png', name: 'Many Lines' });
  });

  it('übergeht Kommentare, Codes mit Leerzeichen, doppelte Codes, andere Vorlagen und die Liste ohne Code', () => {
    assert.deepEqual(
      entries.map((entry) => entry.code),
      ['NightOwl', 'OWLCODE', 'AuntieMoon', 'MANYLINES', 'NAMEDCODE', 'r/warframe'],
    );
  });

  it('ohne Vorlage oder bei offener Vorlage leer, ohne Absturz', () => {
    assert.deepEqual(parseGlyphCodes(''), []);
    assert.deepEqual(parseGlyphCodes('{{GlyphBoxPromo|Open.png|Open'), []);
  });
});
