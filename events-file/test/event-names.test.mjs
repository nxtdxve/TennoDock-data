// Reine Funktionen der Namen (#188); Beispiele in der Form der WFCD-Sprachdateien, Werte erfunden bzw. öffentlich.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildNames, isEventKey, MAX_NAME, nameOf, previousNames, readLanguages, runningKeys } from '../lib/event-names.mjs';

describe('isEventKey', () => {
  it('erkennt Namen von Events, auch klein geschrieben', () => {
    assert.equal(isEventKey('/Lotus/Language/JadeShadows/JadeShadowsEventName'), true);
    assert.equal(isEventKey('/lotus/language/isleweaver/duvirimurmureventtitle'), true);
    assert.equal(isEventKey('/lotus/language/infestedplainsevent/infestedplainsbountyname'), true);
    assert.equal(isEventKey('/lotus/language/events/halloweennaberusname'), true);
  });

  it('keine Beschreibungen, Punkte-Texte oder fremden Schlüssel', () => {
    assert.equal(isEventKey('/Lotus/Language/JadeShadows/JadeShadowsEventDesc'), false);
    assert.equal(isEventKey('/Lotus/Language/G1Quests/HeatFissuresEventScore'), false);
    assert.equal(isEventKey('SolNode1EventName'), false);
  });
});

describe('nameOf und readLanguages', () => {
  it('liest `{ value }`, trimmt und ersetzt Steuerzeichen', () => {
    assert.equal(nameOf({ value: '  Operation:\nEight Claw ' }), 'Operation: Eight Claw');
    assert.equal(nameOf('Star Days'), 'Star Days');
    assert.equal(nameOf({ value: 'x'.repeat(MAX_NAME + 1) }), undefined);
    assert.equal(nameOf({ value: 3 }), undefined);
  });

  it('Schlüssel klein geschrieben, der erste gewinnt', () => {
    const names = readLanguages({ '/Lotus/Language/A/AEventName': { value: 'A' }, '/lotus/language/a/aeventname': { value: 'B' }, nope: { value: 'C' } });
    assert.deepEqual([...names], [['/lotus/language/a/aeventname', 'A']]);
    assert.equal(readLanguages(undefined).size, 0);
  });
});

describe('runningKeys', () => {
  it('nimmt `Desc` der laufenden Events aus dem worldState', () => {
    assert.deepEqual(runningKeys({ Goals: [{ Desc: '/Lotus/Language/New/NewOperationLabel' }, { Tag: 'X' }, 'kaputt'] }), ['/lotus/language/new/newoperationlabel']);
    assert.deepEqual(runningKeys({}), []);
  });
});

describe('buildNames', () => {
  const en = new Map([
    ['/lotus/language/jadeshadows/jadeshadowseventname', 'Operation: Belly of the Beast'],
    ['/lotus/language/events/halloweennaberusname', 'Nights of Naberus'],
    ['/lotus/language/new/newoperationlabel', 'Operation: New'],
    ['/lotus/language/other/somethingelse', 'Something else'],
  ]);
  const de = new Map([
    ['/lotus/language/jadeshadows/jadeshadowseventname', 'Operation: Belly of the Beast'],
    ['/lotus/language/events/halloweennaberusname', 'Die Naberus Nacht'],
  ]);

  it('Event-Schlüssel aus der Quelle, Deutsch nur, wenn es anders lautet', () => {
    assert.deepEqual(buildNames({ en, de }), {
      '/lotus/language/events/halloweennaberusname': { en: 'Nights of Naberus', de: 'Die Naberus Nacht' },
      '/lotus/language/jadeshadows/jadeshadowseventname': { en: 'Operation: Belly of the Beast' },
    });
  });

  it('dazu laufende Events mit anderem Schlüssel; Bisheriges bleibt, auch wenn die Quelle es nicht mehr führt', () => {
    const names = buildNames({ en, de, running: ['/lotus/language/new/newoperationlabel', '/lotus/language/unknown/x'], previous: { '/lotus/language/old/oldeventname': { en: 'Operation: Old' } } });
    assert.deepEqual(Object.keys(names), [
      '/lotus/language/events/halloweennaberusname',
      '/lotus/language/jadeshadows/jadeshadowseventname',
      '/lotus/language/new/newoperationlabel',
      '/lotus/language/old/oldeventname',
    ]);
  });

  it('previousNames liest nur gültige Einträge', () => {
    assert.deepEqual(previousNames({ names: { '/Lotus/A': { en: 'A', de: 'Ä' }, '/lotus/b': { de: 'B' }, x: { en: 'X' } } }), { '/lotus/a': { en: 'A', de: 'Ä' } });
    assert.deepEqual(previousNames(undefined), {});
  });
});
