// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMIT_URL, OUTPUT, rawUrl, run } from '../build.mjs';
import { entryOf, polarityOf, polarityTable, SOURCE_FILES } from '../lib/polarities.mjs';

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
