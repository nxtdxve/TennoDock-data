// Ablauf der Action (#188) ohne Netz: Antworten erfunden, Dateien im Speicher.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFile, DE_URL, EN_URL, FILE, outputLines, readNamesFile, run, WORLDSTATE_URL } from '../build.mjs';

const NOW = Date.parse('2026-11-23T12:41:00Z');
const EN = { '/Lotus/Language/JadeShadows/JadeShadowsEventName': { value: 'Operation: Belly of the Beast' }, '/lotus/language/events/halloweennaberusname': { value: 'Nights of Naberus' }, '/lotus/language/new/newlabel': { value: 'Operation: New' } };
const DE = { '/lotus/language/events/halloweennaberusname': { value: 'Die Naberus Nacht' } };
const WORLDSTATE = { Goals: [{ Tag: 'NewEvent', Desc: '/Lotus/Language/New/NewLabel' }] };

function memoryFiles(initial = {}) {
  const files = new Map(Object.entries(initial));
  return { files, read: async (path) => files.get(path), write: async (path, text) => void files.set(path, text) };
}

/** Antworten pro Adresse; `worldState: false` lässt den Abruf scheitern. */
function fakeFetch({ en = EN, de = DE, worldState = WORLDSTATE } = {}) {
  const urls = [];
  const fetchText = async (url) => {
    urls.push(url);
    if (url === EN_URL) return { status: 200, text: JSON.stringify(en) };
    if (url === DE_URL) return { status: 200, text: JSON.stringify(de) };
    if (url === WORLDSTATE_URL) return worldState ? { status: 200, text: JSON.stringify(worldState) } : { status: 503, text: '' };
    return { status: 404, text: '' };
  };
  return { fetchText, urls };
}

const deps = (files, fetch, extra = {}) => ({ fetchText: fetch.fetchText, files, now: NOW, log: () => undefined, minEntries: 1, minNames: 1, ...extra });

describe('run', () => {
  it('schreibt die Namen aus WFCD und dem laufenden Event, drei Abrufe', async () => {
    const files = memoryFiles();
    const fetch = fakeFetch();
    const result = await run(deps(files, fetch));
    assert.deepEqual(result, { written: true, asOf: '2026-11-23', names: 3 });
    assert.deepEqual(fetch.urls, [EN_URL, DE_URL, WORLDSTATE_URL]);
    const file = JSON.parse(files.files.get(FILE));
    assert.equal(file.format, 'tennodock-event-names');
    assert.equal(file.license, 'MIT');
    assert.deepEqual(file.names['/lotus/language/events/halloweennaberusname'], { en: 'Nights of Naberus', de: 'Die Naberus Nacht' });
    assert.deepEqual(file.names['/lotus/language/new/newlabel'], { en: 'Operation: New' });
  });

  it('ohne Änderung bleibt die Datei, auch an einem anderen Tag', async () => {
    const files = memoryFiles();
    await run(deps(files, fakeFetch()));
    const before = files.files.get(FILE);
    const result = await run(deps(files, fakeFetch(), { now: NOW + 3 * 86_400_000 }));
    assert.equal(result.written, false);
    assert.equal(result.asOf, '2026-11-23');
    assert.equal(files.files.get(FILE), before);
  });

  it('ohne worldState geht es mit den Mustern und dem bisherigen Stand weiter', async () => {
    const files = memoryFiles();
    const logs = [];
    const result = await run(deps(files, fakeFetch({ worldState: false }), { log: (text) => logs.push(text) }));
    assert.equal(result.names, 2);
    assert.match(logs[0], /World state not read/);
  });

  it('eine kaputte oder viel zu kleine Quelle schreibt nichts', async () => {
    const files = memoryFiles();
    await assert.rejects(run(deps(files, fakeFetch(), { minEntries: 10 })), /Only 3 English entries/);
    await assert.rejects(run(deps(files, fakeFetch({ en: {} }), { minEntries: 0, minNames: 1 })), /Only 0 event names/);
    assert.equal(files.files.size, 0);
  });

  it('ein Name, den die Quelle nicht mehr führt, bleibt', async () => {
    const files = memoryFiles({ [FILE]: JSON.stringify(buildFile({ '/lotus/language/old/oldeventname': { en: 'Operation: Old' } }, NOW)) });
    await run(deps(files, fakeFetch()));
    assert.deepEqual(readNamesFile(files.files.get(FILE))?.names['/lotus/language/old/oldeventname'], { en: 'Operation: Old' });
  });
});

describe('outputLines', () => {
  it('nur Datum und Zahl, sonst Abbruch', () => {
    assert.equal(outputLines({ written: true, asOf: '2026-11-23', names: 13 }), 'asOf=2026-11-23\nnames=13\n');
    assert.throws(() => outputLines({ written: true, asOf: '2026-11-23\nx=1', names: 1 }));
  });
});
