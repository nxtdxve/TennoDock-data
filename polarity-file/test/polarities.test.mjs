// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMIT_URL, OUTPUT, POSITIONS, rawUrl, run } from '../build.mjs';
import { applyPositions, entryOf, polarityOf, polarityTable, POSITIONS_FORMAT, SOURCE_FILES } from '../lib/polarities.mjs';

test('rechnet die Namen aus dem Wiki in die Polaritäten des Spielstands um, „aura“ und „universal“ als Omni', () => {
  assert.equal(polarityOf('madurai'), 'AP_ATTACK');
  assert.equal(polarityOf('Naramon'), 'AP_TACTIC');
  assert.equal(polarityOf('penjaga'), 'AP_PRECEPT');
  assert.equal(polarityOf('aura'), 'AP_ANY');
  assert.equal(polarityOf('universal'), 'AP_ANY');
  assert.equal(polarityOf('exilus'), undefined);
  assert.equal(polarityOf(3), undefined);
});

test('nimmt Mod-Plätze, Aura (Jade mit zwei), Exilus und Haltung, sonst nichts', () => {
  assert.deepEqual(entryOf({ polarities: ['naramon', 'madurai'], aura: 'madurai' }), { p: ['AP_TACTIC', 'AP_ATTACK'], a: 'AP_ATTACK' });
  assert.deepEqual(entryOf({ polarities: ['naramon'], aura: ['aura', 'vazarin'] }), { p: ['AP_TACTIC'], a: ['AP_ANY', 'AP_DEFENSE'] });
  assert.deepEqual(entryOf({ exilusPolarity: 'naramon' }), { x: 'AP_TACTIC' });
  assert.deepEqual(entryOf({ stancePolarity: 'madurai', polarities: ['unknown'] }), { s: 'AP_ATTACK' });
  assert.equal(entryOf({ name: 'Ohne' }), undefined);
});

test('baut die Tabelle nach Lotus-Pfad, sortiert, ohne fremde Einträge', () => {
  const table = polarityTable([
    [{ uniqueName: '/Lotus/Powersuits/Volt/Volt', polarities: ['naramon', 'madurai'], aura: 'madurai' }, { uniqueName: 'kaputt', aura: 'madurai' }, null],
    [{ uniqueName: '/Lotus/Powersuits/Ash/Ash', polarities: ['madurai'] }, { uniqueName: '/Lotus/Weapons/Ohne', name: 'x' }],
  ]);
  assert.deepEqual(Object.keys(table), ['/Lotus/Powersuits/Ash/Ash', '/Lotus/Powersuits/Volt/Volt']);
});

test('schreibt die Datei nur bei neuem Stand und prüft, ob er plausibel ist', async () => {
  const sha = 'a'.repeat(40);
  /** @type {Record<string, string>} */
  const written = {};
  const items = Array.from({ length: 3 }, (_, i) => ({ uniqueName: `/Lotus/Powersuits/F${i}/F${i}`, polarities: ['madurai'] }));
  const fetchText = async (/** @type {string} */ url) => {
    if (url === COMMIT_URL) return { status: 200, text: JSON.stringify({ sha }) };
    for (const file of SOURCE_FILES) if (url === rawUrl(sha, file)) return { status: 200, text: JSON.stringify(file === 'Warframes' ? items : []) };
    return { status: 404, text: '' };
  };
  const files = { read: async (/** @type {string} */ path) => written[path], write: async (/** @type {string} */ path, /** @type {string} */ text) => void (written[path] = text) };
  const log = () => undefined;
  const now = Date.UTC(2026, 10, 6, 12);
  const first = await run({ fetchText, files, now, log, minItems: 3 });
  assert.equal(first.written, true);
  const file = JSON.parse(written[OUTPUT] ?? '');
  assert.equal(file.format, 'tennodock-polarities');
  assert.equal(file.asOf, '2026-11-06');
  assert.equal(file.license, 'MIT');
  assert.deepEqual(file.items['/Lotus/Powersuits/F1/F1'], { p: ['AP_ATTACK'] });
  // Gleicher Commit: nichts.
  assert.equal((await run({ fetchText, files, now, log, minItems: 3 })).written, false);
  // Zu wenig Items: Fehler statt einer leeren Datei.
  await assert.rejects(run({ fetchText, files: { read: async () => undefined, write: files.write }, now, log, minItems: 10 }), /Implausible/);
});

const VOLT = '/Lotus/Powersuits/Volt/Volt';
const positions = (/** @type {Record<string, unknown>} */ items) => ({ format: POSITIONS_FORMAT, v: 1, items });
const entry = (/** @type {string[]} */ p, /** @type {number[]} */ pm) => ({ p, pm, source: 'Test', date: '2026-11-08' });

test('setzt die Plätze ab Werk (#194), nur wenn sie zur Liste von WFCD passen', () => {
  const items = { [VOLT]: { p: ['AP_TACTIC', 'AP_ATTACK'], a: 'AP_ATTACK' }, '/Lotus/Powersuits/Ash/Ash': { p: ['AP_ATTACK'] }, '/Lotus/Weapons/W': { x: 'AP_TACTIC' } };
  const result = applyPositions(items, positions({
    [VOLT]: entry(['AP_TACTIC', 'AP_ATTACK'], [7, 0]),
    '/Lotus/Powersuits/Ash/Ash': entry(['AP_DEFENSE'], [3]),
    '/Lotus/Weapons/W': entry(['AP_ATTACK'], [1]),
  }));
  assert.deepEqual(result.items[VOLT], { p: ['AP_TACTIC', 'AP_ATTACK'], pm: [7, 0], a: 'AP_ATTACK' });
  // Liste geändert (Rework) oder ohne Mod-Polaritäten: kein pm, dafür eine Meldung.
  assert.deepEqual(result.items['/Lotus/Powersuits/Ash/Ash'], { p: ['AP_ATTACK'] });
  assert.deepEqual(result.problems, ['/Lotus/Powersuits/Ash/Ash: WFCD list changed', '/Lotus/Weapons/W: no built-in mod polarities in WFCD']);
  assert.deepEqual(result.sources, ['Test']);
  // Die Eingabe bleibt unverändert.
  assert.equal('pm' in items[VOLT], false);
});

test('nimmt keine falschen Plätze und verlangt Quelle und Datum', () => {
  const items = { [VOLT]: { p: ['AP_TACTIC', 'AP_ATTACK'] } };
  for (const pm of [[7], [7, 7], [7, 12], [-1, 0], [1.5, 0]]) {
    assert.deepEqual(applyPositions(items, positions({ [VOLT]: entry(['AP_TACTIC', 'AP_ATTACK'], pm) })).problems, [`${VOLT}: bad positions`]);
  }
  assert.deepEqual(applyPositions(items, positions({ [VOLT]: { p: ['AP_TACTIC', 'AP_ATTACK'], pm: [7, 0] } })).problems, [`${VOLT}: source or date missing`]);
  assert.throws(() => applyPositions(items, { format: 'andere', v: 1, items: {} }), /wrong format/);
});

test('schreibt pm und die Quellen in die Datei; ohne positions.json bleibt alles wie bisher', async () => {
  const sha = 'b'.repeat(40);
  const wf = [{ uniqueName: VOLT, polarities: ['naramon', 'madurai'], aura: 'madurai' }, { uniqueName: '/Lotus/Powersuits/A/A', polarities: ['madurai'] }, { uniqueName: '/Lotus/Powersuits/B/B', polarities: ['vazarin'] }];
  const fetchText = async (/** @type {string} */ url) => {
    if (url === COMMIT_URL) return { status: 200, text: JSON.stringify({ sha }) };
    for (const file of SOURCE_FILES) if (url === rawUrl(sha, file)) return { status: 200, text: JSON.stringify(file === 'Warframes' ? wf : []) };
    return { status: 404, text: '' };
  };
  /** @type {Record<string, string>} */
  const written = { [POSITIONS]: JSON.stringify(positions({ [VOLT]: entry(['AP_TACTIC', 'AP_ATTACK'], [7, 0]) })) };
  const files = { read: async (/** @type {string} */ path) => written[path], write: async (/** @type {string} */ path, /** @type {string} */ text) => void (written[path] = text) };
  /** @type {string[]} */
  const logs = [];
  await run({ fetchText, files, now: Date.UTC(2026, 10, 8), log: (text) => logs.push(text), minItems: 3 });
  const file = JSON.parse(written[OUTPUT] ?? '');
  assert.deepEqual(file.items[VOLT], { p: ['AP_TACTIC', 'AP_ATTACK'], pm: [7, 0], a: 'AP_ATTACK' });
  assert.deepEqual(file.positionSources, ['Test']);
  // Ohne Datei: keine Plätze, kein Feld positionSources.
  /** @type {Record<string, string>} */
  const plain = {};
  await run({ fetchText, files: { read: async (/** @type {string} */ path) => plain[path], write: async (/** @type {string} */ path, /** @type {string} */ text) => void (plain[path] = text) }, now: Date.UTC(2026, 10, 8), log: () => undefined, minItems: 3 });
  const without = JSON.parse(plain[OUTPUT] ?? '');
  assert.equal('pm' in without.items[VOLT], false);
  assert.equal('positionSources' in without, false);
});

test('die mitgelieferte positions.json ist gültig', async () => {
  const { readFile } = await import('node:fs/promises');
  const file = JSON.parse(await readFile(new URL('../positions.json', import.meta.url), 'utf8'));
  assert.equal(file.format, POSITIONS_FORMAT);
  assert.doesNotThrow(() => applyPositions({}, file));
});
