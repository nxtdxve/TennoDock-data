// Ablauf der Action (#106) ohne Netz: Abrufe kommen aus der erfundenen Datei (fixture.mjs), Dateien aus dem Speicher.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COMMIT_URL, firstWords, listUrl, rawUrl, readKimFile, run, withoutTexts } from '../build.mjs';
import { DICT, GROUP, TESTA } from './fixture.mjs';

const SHA = 'a'.repeat(40);
const NOW = Date.parse('2026-10-27T05:43:00Z');
const LIMITS = { minPeople: 1, minConversations: 1 };

function memoryFiles(initial = {}) {
  const files = new Map(Object.entries(initial));
  return { files, read: async (path) => files.get(path), write: async (path, text) => void files.set(path, text) };
}

function fakeFetch({ sha = SHA, broken = false, noGerman = false } = {}) {
  const urls = [];
  const json = (value) => ({ status: 200, text: JSON.stringify(value) });
  const fetchText = async (url) => {
    urls.push(url);
    if (url === COMMIT_URL) return json({ sha, commit: { committer: { date: '2026-06-17T23:50:36Z' } } });
    if (url === listUrl(sha)) return json([{ name: 'TestaDialogue_rom.dialogue.json' }, { name: 'HexDialogue_rom.dialogue.json' }, { name: 'README.md' }]);
    if (url === rawUrl(sha, 'data/TestaDialogue_rom.dialogue.json')) return broken ? { status: 200, text: '[]' } : json(TESTA);
    if (url === rawUrl(sha, 'data/HexDialogue_rom.dialogue.json')) return json(GROUP);
    if (url === rawUrl(sha, 'dicts/en.json')) return json(DICT);
    if (url === rawUrl(sha, 'dicts/de.json')) return noGerman ? { status: 404, text: '' } : json({ ...DICT, 'L/sure': 'Klar.' });
    return { status: 404, text: '' };
  };
  return { fetchText, urls };
}

const deps = (files, fetch, extra = {}) => ({ fetchText: fetch.fetchText, files, now: NOW, log: () => undefined, ...LIMITS, ...extra });

describe('run', () => {
  it('baut beim ersten Lauf eine Datei pro Sprache mit Quelle und Stand', async () => {
    const files = memoryFiles();
    const result = await run(deps(files, fakeFetch()));
    assert.equal(result.written, true);
    const en = readKimFile(files.files.get('v1/en.json'));
    const de = readKimFile(files.files.get('v1/de.json'));
    assert.equal(en?.commit, SHA);
    assert.equal(en?.asOf, '2026-06-17');
    assert.equal(en?.generatedAt, '2026-10-27T05:43:00Z');
    assert.equal(en?.source, 'Sainan/warframe-kim-dialogues');
    assert.equal(en?.texts, true);
    assert.deepEqual(Object.keys(en?.people ?? {}), ['Testa']);
    assert.equal(en?.people['Testa']?.['TestaRank2Convo1']?.c[0]?.a[0]?.t, 'Sure.');
    assert.equal(de?.people['Testa']?.['TestaRank2Convo1']?.c[0]?.a[0]?.t, 'Klar.');
  });

  it('holt nichts weiter, solange der Commit gleich ist', async () => {
    const files = memoryFiles();
    await run(deps(files, fakeFetch()));
    const again = fakeFetch();
    const result = await run(deps(files, again));
    assert.equal(result.written, false);
    assert.deepEqual(again.urls, [COMMIT_URL]);
  });

  it('REBUILD ohne Änderung am Inhalt schreibt nichts, auch kein neues generatedAt', async () => {
    const files = memoryFiles();
    await run(deps(files, fakeFetch()));
    const before = files.files.get('v1/en.json');
    const result = await run(deps(files, fakeFetch(), { rebuild: true, now: NOW + 86400000 }));
    assert.equal(result.written, false);
    assert.equal(files.files.get('v1/en.json'), before);
  });

  it('schreibt keine Sprache, wenn eine andere scheitert', async () => {
    const files = memoryFiles();
    await assert.rejects(run(deps(files, fakeFetch({ noGerman: true }))), /HTTP 404/);
    assert.equal(files.files.size, 0);
  });

  it('baut neu bei neuem Commit', async () => {
    const files = memoryFiles();
    await run(deps(files, fakeFetch()));
    const next = 'b'.repeat(40);
    assert.equal((await run(deps(files, fakeFetch({ sha: next })))).written, true);
    assert.equal(readKimFile(files.files.get('v1/en.json'))?.commit, next);
  });

  it('schreibt nichts, wenn der neue Stand nicht plausibel ist', async () => {
    const files = memoryFiles();
    await run(deps(files, fakeFetch()));
    const before = files.files.get('v1/en.json');
    await assert.rejects(run(deps(files, fakeFetch({ sha: 'c'.repeat(40), broken: true }))), /not written: only 0 people/);
    assert.equal(files.files.get('v1/en.json'), before);
    await assert.rejects(run(deps(memoryFiles(), fakeFetch(), { minPeople: 8 })), /only 1 people/);
  });

  it('ohne Spieltexte: nur Zahlen, erste Nachricht in drei Wörtern', async () => {
    const files = memoryFiles();
    await run(deps(files, fakeFetch(), { texts: false }));
    const en = readKimFile(files.files.get('v1/en.json'));
    const convo = en?.people['Testa']?.['TestaRank2Convo1'];
    assert.equal(en?.texts, false);
    assert.equal(convo?.first, 'hey there');
    assert.deepEqual(convo?.c[0], { a: [{ c: 10 }, { f: 'n' }] });
    assert.deepEqual(convo?.c[2]?.if, ['TestaLikesCats', true]);
  });

  it('scheitert ohne lesbaren Commit', async () => {
    const fetchText = async () => ({ status: 403, text: 'rate limit' });
    await assert.rejects(run({ fetchText, files: memoryFiles(), now: NOW, log: () => undefined }), /HTTP 403/);
  });
});

describe('firstWords', () => {
  it('„ …“ nur, wenn nach drei Wörtern noch etwas kommt', () => {
    assert.equal(firstWords('one two three four'), 'one two three …');
    assert.equal(firstWords('hey there'), 'hey there');
  });
});

describe('withoutTexts', () => {
  it('lässt Rang und Bedingungen stehen', () => {
    const people = { P: { PRank1Convo1: { r: 1, first: 'one two three four', c: [{ p: 'q', a: [{ t: 'x', c: 5 }], af: [0, [1]] }] } } };
    assert.deepEqual(withoutTexts(people), { P: { PRank1Convo1: { r: 1, first: 'one two three …', c: [{ a: [{ c: 5 }], af: [0, [1]] }] } } });
  });
});
