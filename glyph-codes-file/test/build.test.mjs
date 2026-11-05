// Ablauf der Action (#122) ohne Netz: Die Antwort des Wikis ist erfunden, Dateien liegen im Speicher.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { API_URL, buildFile, FILE, readGlyphCodesFile, readRevision, run } from '../build.mjs';
import { SECTION } from './fixture.mjs';

const NOW = Date.parse('2026-11-09T06:29:00Z');
const PAGE = ['Intro', '==Glyphs==', '{{GlyphBoxPromo|Not.png|NotCreator}}', SECTION, '==Legendary Glyphs==', 'x'].join('\n');

function memoryFiles(initial = {}) {
  const files = new Map(Object.entries(initial));
  return { files, read: async (path) => files.get(path), write: async (path, text) => void files.set(path, text) };
}

const answer = (text = PAGE, revid = 1001, timestamp = '2026-10-22T18:20:30Z') =>
  JSON.stringify({ batchcomplete: true, query: { pages: [{ pageid: 7, title: 'Glyph', revisions: [{ revid, parentid: 1000, timestamp, slots: { main: { contentmodel: 'wikitext', content: text } } }] }] } });

function fakeFetch(responses) {
  const urls = [];
  const queue = [...responses];
  const fetchText = async (url) => {
    urls.push(url);
    return queue.shift() ?? { status: 200, text: answer() };
  };
  return { fetchText, urls };
}

const deps = (files, fetch, extra = {}) => ({ fetchText: fetch.fetchText, files, now: NOW, log: () => undefined, minCodes: 1, sleep: async () => undefined, ...extra });

describe('readRevision', () => {
  it('liest Text, Nummer und Zeit der Fassung', () => {
    assert.deepEqual(readRevision(JSON.parse(answer('abc'))), { text: 'abc', revision: 1001, revisedAt: '2026-10-22T18:20:30Z' });
  });

  it('ohne Seite oder in fremder Form undefined', () => {
    assert.equal(readRevision({ query: { pages: [{ title: 'Glyph', missing: true }] } }), undefined);
    assert.equal(readRevision(undefined), undefined);
    assert.equal(readRevision({ query: { pages: [{ revisions: [{ revid: '1', timestamp: 'x', slots: { main: { content: 'a' } } }] }] } }), undefined);
  });
});

describe('buildFile', () => {
  it('nimmt nur den Abschnitt der Creator-Glyphen, mit Stand, Quelle und Lizenz', () => {
    const file = buildFile({ text: PAGE, revision: 1001, revisedAt: '2026-10-22T18:20:30Z' }, NOW, 1);
    assert.equal(file.format, 'tennodock-glyph-codes');
    assert.equal(file.v, 1);
    assert.equal(file.asOf, '2026-10-22');
    assert.equal(file.revisedAt, '2026-10-22T18:20:30Z');
    assert.equal(file.generatedAt, '2026-11-09T06:29:00Z');
    assert.equal(file.source, 'wiki.warframe.com');
    assert.equal(file.license, 'CC BY-NC-SA 3.0');
    assert.equal(file.revision, 1001);
    assert.equal(file.codes.length, 6);
    assert.ok(!file.codes.some((entry) => entry.code === 'NotCreator'));
  });

  it('scheitert ohne Abschnitt oder mit zu wenigen Codes', () => {
    assert.throws(() => buildFile({ text: 'Intro', revision: 1, revisedAt: '2026-10-22T18:20:30Z' }, NOW, 1), /No section/);
    assert.throws(() => buildFile({ text: PAGE, revision: 1, revisedAt: '2026-10-22T18:20:30Z' }, NOW), /Only 6 codes/);
  });
});

describe('run', () => {
  it('schreibt beim ersten Lauf die Datei, die die App liest', async () => {
    const files = memoryFiles();
    const fetch = fakeFetch([]);
    const result = await run(deps(files, fetch));
    assert.deepEqual(result, { written: true, asOf: '2026-10-22', revision: 1001, codes: 6 });
    assert.deepEqual(fetch.urls, [API_URL]);
    assert.equal(readGlyphCodesFile(files.files.get(FILE))?.codes[1]?.name, 'OwlTwo');
  });

  it('schreibt nichts, solange sich die Liste nicht ändert, auch nicht an einem anderen Tag', async () => {
    const files = memoryFiles();
    await run(deps(files, fakeFetch([])));
    const before = files.files.get(FILE);
    const result = await run(deps(files, fakeFetch([]), { now: NOW + 7 * 86_400_000 }));
    assert.equal(result.written, false);
    assert.equal(files.files.get(FILE), before);
  });

  it('schreibt neu, wenn die Seite eine neue Fassung hat', async () => {
    const files = memoryFiles();
    await run(deps(files, fakeFetch([])));
    const result = await run(deps(files, fakeFetch([{ status: 200, text: answer(PAGE.replace('OWLCODE', 'OWLCODE2'), 1002, '2026-11-08T10:00:00Z') }])));
    assert.equal(result.written, true);
    const file = readGlyphCodesFile(files.files.get(FILE));
    assert.equal(file?.asOf, '2026-11-08');
    assert.equal(file?.codes[1]?.code, 'OWLCODE2');
  });

  it('ersetzt den Stand nicht, wenn die Liste um mehr als die Hälfte schrumpft', async () => {
    const files = memoryFiles();
    await run(deps(files, fakeFetch([])));
    const before = files.files.get(FILE);
    const small = ['==Creator Glyphs==', '{{GlyphBoxPromo|AGlyph.png|Alpha}}', '{{GlyphBoxPromo|BGlyph.png|Beta}}'].join('\n');
    await assert.rejects(run(deps(files, fakeFetch([{ status: 200, text: answer(small, 1003) }]))), /2 codes, before 6/);
    assert.equal(files.files.get(FILE), before);
  });

  it('wartet bei 429, 5xx und maxlag und versucht es noch zweimal', async () => {
    const waits = [];
    const fetch = fakeFetch([{ status: 503, text: '' }, { status: 200, text: JSON.stringify({ error: { code: 'maxlag' } }), retryAfter: 5 }]);
    const result = await run(deps(memoryFiles(), fetch, { sleep: async (ms) => void waits.push(ms) }));
    assert.equal(result.written, true);
    assert.equal(fetch.urls.length, 3);
    assert.deepEqual(waits, [10_000, 5_000]);
  });

  it('scheitert ohne lesbare Antwort und schreibt nichts', async () => {
    const files = memoryFiles();
    await assert.rejects(run(deps(files, fakeFetch([{ status: 404, text: '' }]))), /HTTP 404/);
    await assert.rejects(run(deps(files, fakeFetch([{ status: 200, text: '<html>' }]))), /Not JSON/);
    await assert.rejects(run(deps(files, fakeFetch([{ status: 200, text: JSON.stringify({ query: { pages: [{ missing: true }] } }) }]))), /No page/);
    assert.equal(files.files.size, 0);
  });
});
