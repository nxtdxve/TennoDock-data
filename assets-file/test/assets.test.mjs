// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFamily, buildManifest, imageSize, MAX_PACK_BYTES, sha256 } from '../lib/assets.mjs';

/** Kleinste gültige Köpfe, nur für die Masse. */
function png(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function webpVp8x(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(22, 4);
  b.write('WEBPVP8X', 8, 'ascii');
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
}
function webpVp8l(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBPVP8L', 8, 'ascii');
  b[20] = 0x2f;
  b.writeUInt32LE(((h - 1) << 14) | (w - 1), 21);
  return b;
}
function webpVp8(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBPVP8 ', 8, 'ascii');
  b[23] = 0x9d;
  b[24] = 0x01;
  b[25] = 0x2a;
  b.writeUInt16LE(w, 26);
  b.writeUInt16LE(h, 28);
  return b;
}

const SOURCES_MD = '| A.png |\n| B.webp |\n';

describe('imageSize', () => {
  it('liest PNG und alle drei WebP-Arten', () => {
    assert.deepEqual(imageSize(png(281, 117)), { w: 281, h: 117, type: 'png' });
    assert.deepEqual(imageSize(webpVp8x(512, 256)), { w: 512, h: 256, type: 'webp' });
    assert.deepEqual(imageSize(webpVp8l(64, 64)), { w: 64, h: 64, type: 'webp' });
    assert.deepEqual(imageSize(webpVp8(242, 338)), { w: 242, h: 338, type: 'webp' });
  });

  it('erkennt anderes nicht', () => {
    assert.equal(imageSize(Buffer.from('GIF89a........................')), undefined);
    assert.equal(imageSize(Buffer.alloc(4)), undefined);
  });
});

describe('buildFamily', () => {
  const files = () =>
    new Map([
      ['B.webp', webpVp8x(10, 20)],
      ['A.png', png(3, 4)],
    ]);

  it('packt alle Bilder als Data-URL und nennt Hash, Grösse, Masse und Quelle', () => {
    const { entry, pack } = buildFamily('mod-frames', files(), SOURCES_MD, { default: 'wiki', files: { B: 'genesis-assets' } });
    const parsed = JSON.parse(pack);
    assert.equal(parsed.format, 'tennodock-asset-pack');
    assert.equal(parsed.v, 1);
    assert.equal(parsed.family, 'mod-frames');
    assert.deepEqual(Object.keys(parsed.parts), ['A', 'B']);
    assert.match(parsed.parts.A, /^data:image\/png;base64,/);
    assert.match(parsed.parts.B, /^data:image\/webp;base64,/);
    assert.equal(entry.pack, 'packs/mod-frames.json');
    assert.equal(entry.sha256, sha256(Buffer.from(pack)));
    assert.equal(entry.bytes, Buffer.byteLength(pack));
    assert.deepEqual(entry.files.A, { file: 'mod-frames/A.png', sha256: sha256(png(3, 4)), bytes: 33, w: 3, h: 4, src: 'wiki' });
    assert.equal(entry.files.B?.src, 'genesis-assets');
  });

  it('ist bei gleichem Inhalt byte-gleich, unabhängig von der Reihenfolge', () => {
    const a = buildFamily('x', files(), SOURCES_MD, { default: 'wiki' });
    const b = buildFamily('x', new Map([...files()].reverse()), SOURCES_MD, { default: 'wiki' });
    assert.equal(a.pack, b.pack);
  });

  it('meldet fehlende Herkunft, falsche Endung, doppelte Namen und unbekannte Quellen auf einmal', () => {
    const bad = new Map([
      ['A.png', png(1, 1)],
      ['A.webp', webpVp8x(1, 1)],
      ['C.jpg', Buffer.from('x')],
      ['D.png', webpVp8x(1, 1)],
    ]);
    assert.throws(
      () => buildFamily('x', bad, '| A.png |', { default: 'wiki', files: { A: 'elsewhere', Z: 'wiki' } }),
      (error) => {
        const text = String(error);
        return ['A.webp: more than one file named "A"', 'C.jpg: only', 'D.png: not a readable png', 'unknown source "elsewhere"', '"Z", but there is no such file'].every((part) => text.includes(part));
      },
    );
  });

  it('lehnt zu grosse Packs ab', () => {
    const big = Buffer.concat([png(1, 1), Buffer.alloc(MAX_PACK_BYTES)]);
    assert.throws(() => buildFamily('x', new Map([['A.png', big]]), SOURCES_MD, { default: 'wiki' }), /more than/);
  });
});

describe('buildManifest', () => {
  const families = { x: { pack: 'packs/x.json', sha256: 'a', bytes: 1, files: {} } };

  it('behält den Stand, solange sich nichts ändert', () => {
    const first = buildManifest(families, undefined, '2026-11-06');
    assert.equal(first.asOf, '2026-11-06');
    assert.equal(first.format, 'tennodock-assets');
    assert.equal(buildManifest(families, first, '2026-11-09').asOf, '2026-11-06');
  });

  it('setzt einen neuen Stand bei einer Änderung', () => {
    const first = buildManifest(families, undefined, '2026-11-06');
    assert.equal(buildManifest({ x: { ...families.x, sha256: 'b' } }, first, '2026-11-09').asOf, '2026-11-09');
  });
});
