// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { linkTargets, plain, section, splitArgs, tables, templates } from '../lib/wikitext.mjs';

describe('Wikitext (#164)', () => {
  it('teilt Argumente nur auf der obersten Ebene', () => {
    assert.deepEqual(splitArgs('SceneBox|A.png|[[Duviri|Isle]]|{{sc|25000}}|x'), ['SceneBox', 'A.png', '[[Duviri|Isle]]', '{{sc|25000}}', 'x']);
  });

  it('findet Vorlagen über mehrere Zeilen, benannt und positionell', () => {
    const text = '{{Fragments\n|fragment = Earth\n|planet = [[Earth]]\n|loretext = a {{D|Heat}} b\n}}\n{{SceneBox|a.png|Duviri|Archarbor Scene||Yes|Purchased from [[Acrithis]]|}}';
    const [fragment] = templates(text, 'Fragments');
    assert.equal(fragment?.named['fragment'], 'Earth');
    assert.equal(fragment?.named['planet'], '[[Earth]]');
    assert.deepEqual(templates(text, 'SceneBox')[0]?.positional.slice(0, 3), ['a.png', 'Duviri', 'Archarbor Scene']);
  });

  it('Klartext: Links, Mengen, Fraktionen, Hervorhebung, Fussnoten', () => {
    assert.equal(plain("Purchase from {{Faction|Red Veil}} for {{sc|100,000}} at Rank 5.<ref>x</ref>"), 'Purchase from Red Veil for 100,000 Standing at Rank 5.');
    assert.equal(plain("[[File:A.png|120px]]<br>''Sold'' by [[Baro Ki'Teer|Baro]] for {{pc|50}}"), 'Sold by Baro for 50 Platinum');
    assert.equal(plain('[[Earth]] ([[Plains of Eidolon]])'), 'Earth (Plains of Eidolon)');
    assert.equal(plain('[[Bird 3#Offerings]]'), 'Bird 3');
  });

  it('Linkziele ohne Dateien', () => {
    assert.deepEqual(linkTargets('[[File:X.png|link=Y]]<br>[[Vengeful Chill Ephemera]] [[A#b|c]]'), ['Vengeful Chill Ephemera', 'A']);
  });

  it('Tabellen mit Überschrift, Kopf und Zellen in einer oder mehreren Zeilen', () => {
    const text = '== Market ==\n{| class="wikitable"\n! width=25%|Syandana\n! width=25%|Acquisition\n|-\n|[[A Syandana]]\n| Market\n|-\n| [[B Syandana]] || Baro\n|}';
    const [table] = tables(text);
    assert.equal(table?.heading, 'Market');
    assert.deepEqual(table?.header, ['Syandana', 'Acquisition']);
    assert.deepEqual(table?.rows, [['[[A Syandana]]', 'Market'], ['[[B Syandana]]', 'Baro']]);
  });

  it('Abschnitt bis zur nächsten Überschrift derselben Ebene', () => {
    const text = '==A==\nx\n===Sub===\ny\n==B==\nz';
    assert.equal(section(text, 'A'), 'x\n===Sub===\ny');
    assert.equal(section(text, 'C'), undefined);
  });
});
