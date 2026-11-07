// @ts-check
// Ablauf von `build.mjs` mit erfundenen Seiten und Spieldaten, ohne Netz.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { apiUrl, FILES, outputLines, PAGES, readPages, run } from '../build.mjs';

const LORE = '/Lotus/Types/Lore/Fragments/';
const NOW = Date.UTC(2026, 10, 7, 6, 0);
const game = {
  items: [
    { path: '/Lotus/Types/Items/MiscItems/PhotoboothTileCetusTown', name: 'Cetus Scene' },
    { path: '/Lotus/Types/Items/MiscItems/PhotoboothTileNew', name: 'New Scene' },
    { path: '/Lotus/Powersuits/Ninja/Ninja', name: 'Ash' },
  ],
  names: new Map([['/Lotus/Powersuits/Ninja/Ninja', 'Ash']]),
  codex: {
    loreFragments: { [`${LORE}EarthFragmentA`]: { name: '/L/Earth' } },
    songs: { [`${LORE}MusicFragments/GeneMolds`]: { name: '/L/Song' } },
    fighterFrames: { [`${LORE}FrameFighterFragments/Ash`]: { name: '/L/Ash', suit: '/Lotus/Powersuits/Ninja/Ninja' } },
  },
  dict: { '/L/Earth': 'Earth', '/L/Song': 'Gene Molds', '/L/Ash': 'Ash' },
  vendors: {},
  source: /** @type {const} */ ('de'),
};
const content = {
  'Fragments/Cephalon': '{{Fragments\n|fragment = Earth\n|planet = [[Earth]]\n}}',
  'Somachord/Tones': '{|\n! Location !! Song !! Required Scans\n|-\n| [[Earth]] || [[Gene Molds]] || 4\n|}',
  'Frame Fighter': '===Frame Fighter Fragment Locations===\n{|\n|-\n!Planet\n!Warframes\n|-\n| [[Uranus]]\n| {{WF|Ash}}\n|}',
  Captura: '{{SceneBox|C.png|Cetus|Cetus Scene||Yes|Purchased from {{Faction|Ostron}} offerings|}}',
};
/** @param {Record<string, string>} pages @param {string} [timestamp] */
const answer = (pages, timestamp = '2026-11-01T10:00:00Z') =>
  JSON.stringify({ query: { pages: Object.entries(pages).map(([title, text]) => ({ title, revisions: [{ timestamp, slots: { main: { content: text } } }] })) } });
const minimum = { fragments: 1, songs: 1, fighters: 1, items: 1, game: 1 };

/** Dateien im Speicher. */
function memory() {
  /** @type {Map<string, string>} */
  const store = new Map();
  return { store, read: async (/** @type {string} */ path) => store.get(path), write: async (/** @type {string} */ path, /** @type {string} */ text) => void store.set(path, text) };
}

describe('build (#164)', () => {
  it('ein Abruf für alle Seiten, mit Kennung der Seiten in der Adresse', () => {
    const url = new URL(apiUrl());
    assert.equal(url.searchParams.get('titles'), PAGES.join('|'));
    assert.equal(url.searchParams.get('maxlag'), '5');
    assert.ok(PAGES.length <= 50);
  });

  it('liest geteilte Antworten mit `continue`', () => {
    const read = readPages({ continue: { rvcontinue: '123|456', continue: '||' }, query: { pages: [{ title: 'A', revisions: [{ timestamp: '2026-11-01T10:00:00Z', slots: { main: { content: 'x' } } }] }, { title: 'B', missing: true }] } });
    assert.deepEqual(read, { pages: { A: 'x' }, times: ['2026-11-01T10:00:00Z'], continued: { rvcontinue: '123|456', continue: '||' } });
  });

  it('schreibt alle drei Dateien, beim zweiten Lauf ohne Änderung keine', async () => {
    const files = memory();
    const deps = { fetchText: async () => ({ status: 200, text: answer(content) }), loadGame: async () => game, files, now: NOW, log: () => {}, minimum };
    const first = await run(deps);
    assert.deepEqual(first.written, [FILES.collectibles, FILES.items, FILES.missing]);
    assert.equal(first.asOf, '2026-11-01');
    const collectibles = JSON.parse(files.store.get(FILES.collectibles) ?? '{}');
    assert.equal(collectibles.license, 'CC BY-NC-SA 3.0');
    assert.deepEqual(collectibles.fragments, { [`${LORE}EarthFragmentA`]: 'Earth' });
    assert.deepEqual(collectibles.fighters, { [`${LORE}FrameFighterFragments/Ash`]: 'Uranus' });
    const items = JSON.parse(files.store.get(FILES.items) ?? '{}');
    assert.deepEqual(items.items, { '/Lotus/Types/Items/MiscItems/PhotoboothTileCetusTown': [{ k: 'syndicate', t: 'Purchased from Ostron offerings' }] });
    const missing = JSON.parse(files.store.get(FILES.missing) ?? '{}');
    assert.deepEqual(missing.categories.captura, { total: 2, missing: [{ path: '/Lotus/Types/Items/MiscItems/PhotoboothTileNew', name: 'New Scene', since: '2026-11-07' }] });
    const second = await run({ ...deps, now: NOW + 7 * 86400000 });
    assert.deepEqual(second.written, []);
    assert.match(outputLines(second), /^asOf=2026-11-01\nplaces=3\nitems=1\nmissing=\d+\n$/);
  });

  it('leerer Spiel-Export: missing.json bleibt, wie es ist (Review K9)', async () => {
    const files = memory();
    await run({ fetchText: async () => ({ status: 200, text: answer(content) }), loadGame: async () => game, files, now: NOW, log: () => {}, minimum });
    const before = files.store.get(FILES.missing);
    const logs = [];
    const result = await run({ fetchText: async () => ({ status: 200, text: answer(content) }), loadGame: async () => ({ ...game, items: [] }), files, now: NOW + 86400000, log: (text) => logs.push(text), minimum, wiki: false });
    assert.equal(files.store.get(FILES.missing), before);
    assert.deepEqual(result.written, []);
    assert.ok(logs.some((text) => text.includes('missing.json stays')));
  });

  it('Schalter aus: kein Abruf beim Wiki, die Dateien bleiben, „fehlt“ wird weiter geprüft', async () => {
    const files = memory();
    const calls = [];
    const fetchText = async (/** @type {string} */ url) => (calls.push(url), { status: 200, text: answer(content) });
    await run({ fetchText, loadGame: async () => game, files, now: NOW, log: () => {}, minimum });
    const before = files.store.get(FILES.items);
    const more = { ...game, items: [...game.items, { path: '/Lotus/Types/Items/MiscItems/PhotoboothTileNewer', name: 'Newer Scene' }] };
    const result = await run({ fetchText, loadGame: async () => more, files, now: NOW, log: () => {}, minimum, wiki: false });
    assert.equal(calls.length, 1);
    assert.equal(files.store.get(FILES.items), before);
    assert.deepEqual(result.written, [FILES.missing]);
  });

  it('bricht ab, wenn eine Seite fast leer zurückkommt, und lässt den Stand stehen', async () => {
    const files = memory();
    const deps = { loadGame: async () => game, files, now: NOW, log: () => {}, minimum };
    await run({ ...deps, fetchText: async () => ({ status: 200, text: answer(content) }) });
    const before = files.store.get(FILES.collectibles);
    await assert.rejects(run({ ...deps, fetchText: async () => ({ status: 200, text: answer({ ...content, 'Fragments/Cephalon': 'gone' }) }) }), /Only 0 fragment places/);
    assert.equal(files.store.get(FILES.collectibles), before);
  });

  it('wartet bei maxlag und versucht es erneut', async () => {
    let calls = 0;
    const fetchText = async () => (++calls === 1 ? { status: 200, text: JSON.stringify({ error: { code: 'maxlag' } }) } : { status: 200, text: answer(content) });
    const result = await run({ fetchText, loadGame: async () => game, files: memory(), now: NOW, log: () => {}, minimum, sleep: async () => {} });
    assert.equal(calls, 2);
    assert.equal(result.places, 3);
  });
});
