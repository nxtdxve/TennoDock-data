// Prüfung der Paletten-Datei (#206) mit erfundenen Einträgen; dazu die echte Datei, wenn sie daneben liegt (Daten-Repo).

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { checkPalettes, MINIMUM, PALETTE_ROOT } from '../lib/palettes.mjs';

/** @param {Record<string, unknown>} [extra] */
function file(extra = {}) {
  const palettes = Object.fromEntries(Array.from({ length: MINIMUM }, (_, index) => [`${PALETTE_ROOT}Example${index}`, { a: 'buy', k: 'market', src: ['wiki', 'export'], checked: '2026-11-08' }]));
  return { format: 'tennodock-palettes', v: 1, asOf: '2026-11-08', source: 'wiki.warframe.com', page: 'https://wiki.warframe.com/w/Example', license: 'CC BY-NC-SA 3.0', palettes, ...extra };
}

describe('checkPalettes', () => {
  it('nimmt eine gültige Datei an', () => {
    assert.deepEqual(checkPalettes(file()), []);
  });

  it('meldet Format, Version, Tag und fehlende Angaben', () => {
    const errors = checkPalettes(file({ format: 'other', v: 2, asOf: '8.11.2026', license: '' }));
    assert.equal(errors.length, 4);
  });

  it('meldet falsche Einträge mit Pfad', () => {
    const bad = file();
    bad.palettes['/Lotus/Upgrades/Skins/Example'] = { a: 'soon', k: 'shop', src: ['forum'], checked: '2026-12-01', n: 'x'.repeat(200) };
    const errors = checkPalettes(bad);
    assert.equal(errors.length, 6);
    assert.ok(errors.every((error) => error.startsWith('/Lotus/Upgrades/Skins/Example')));
  });

  it('meldet zu wenige Paletten und kein Objekt', () => {
    assert.match(checkPalettes(file({ palettes: {} }))[0] ?? '', /only 0 palettes/);
    assert.deepEqual(checkPalettes([]), ['the file is not a JSON object']);
  });

  const real = new URL('../../palettes/v1/palettes.json', import.meta.url);
  it('die Datei im Daten-Repo ist gültig', { skip: !existsSync(real) }, () => {
    assert.deepEqual(checkPalettes(JSON.parse(readFileSync(real, 'utf8'))), []);
  });
});
