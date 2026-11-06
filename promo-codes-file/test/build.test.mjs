// Ablauf der Action (#135) ohne Netz: Antwort des Wikis und Namen der Items sind erfunden, Dateien liegen im Speicher.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { activeCodes, API_URL, buildFile, checkVanished, FILE, MAX_ACTIVE, readPage, readPromoCodesFile, run, withFirstSeen, withPaths } from '../build.mjs';
import { nameIndex } from '../lib/rewards.mjs';
import { answer, PAGE, PLUS_DICT, PLUS_EXPORT } from './fixture.mjs';

const NOW = Date.parse('2026-11-06T07:11:00Z');
const DAY_MS = 86_400_000;

function memoryFiles(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    read: async (path) => files.get(path),
    write: async (path, text) => void files.set(path, text),
  };
}

function fakeFetch(responses) {
  const urls = [];
  const queue = [...responses];
  const fetchText = async (url) => {
    urls.push(url);
    return queue.shift() ?? { status: 200, text: answer() };
  };
  return { fetchText, urls };
}

const HASH = '0123456789abcdef';

/** Namen wie `loadNames`: Index aus erfundenen Items; mit bekanntem, gleichem Hash nichts geladen. */
function fakeNames(hash = HASH) {
  const calls = { count: 0, knownHashes: [] };
  return {
    calls,
    names: async (knownHash) => {
      calls.count++;
      calls.knownHashes.push(knownHash);
      return knownHash === hash ? { source: 'unchanged', hash } : { source: 'de', hash, index: nameIndex([PLUS_EXPORT], PLUS_DICT) };
    },
  };
}

const deps = (files, fetch, names = fakeNames().names, extra = {}) => ({
  fetchText: fetch.fetchText,
  files,
  now: NOW,
  log: () => undefined,
  names,
  sleep: async () => undefined,
  ...extra,
});

describe('activeCodes', () => {
  it('jeder Code einmal, ohne abgelaufene, in der Reihenfolge des Wikis', () => {
    const codes = activeCodes(PAGE, '2026-11-06');
    assert.deepEqual(
      codes.map((entry) => entry.code),
      ['SHINYGLYPH', 'EXAMPLE2026', 'BOOSTME', 'PAIR-AAAAA', 'PAIR-BBBBB', 'r/warframe'],
    );
    assert.deepEqual(codes[3], {
      code: 'PAIR-AAAAA',
      context: 'Example Quest promo',
      from: '2026-09-01',
      until: '2026-12-31',
      rewards: [{ text: 'Nikana' }, { text: 'One-time 20% Platinum discount' }],
    });
  });

  it('am Tag des Endes noch dabei', () => {
    assert.ok(activeCodes(PAGE, '2026-10-03').some((entry) => entry.code === 'ENDED'));
  });

  it('scheitert bei einer Seite ohne die Tabelle der abgelaufenen Codes (geleert oder umgebaut)', () => {
    const cut = PAGE.slice(0, PAGE.indexOf('|-\n|OLDCODE5'));
    assert.throws(() => activeCodes(`${cut}|}`, '2026-11-06'), /Only 5 rows/);
  });
});

describe('withFirstSeen', () => {
  const codes = [
    { code: 'OLD', rewards: [] },
    { code: 'NEW', from: '2026-11-01', rewards: [] },
  ];

  it('beim ersten Lauf der Beginn laut Wiki, sonst leer (nicht alles „neu“)', () => {
    assert.deepEqual(withFirstSeen(codes, undefined, '2026-11-06'), {
      codes: [
        { code: 'OLD', rewards: [] },
        { code: 'NEW', from: '2026-11-01', firstSeen: '2026-11-01', rewards: [] },
      ],
      removed: [],
    });
  });

  it('danach bleibt der Wert; ein neuer Code bekommt den Tag des Laufs', () => {
    const previous = buildFile({ text: '', revision: 1, revisedAt: '2026-11-01T00:00:00Z' }, [{ code: 'old', firstSeen: '2026-10-01', rewards: [] }], NOW);
    assert.deepEqual(
      withFirstSeen(codes, previous, '2026-11-06').codes.map((entry) => entry.firstSeen),
      ['2026-10-01', '2026-11-06'],
    );
  });

  it('merkt sich firstSeen entfernter Codes 30 Tage: nach einem Revert sind sie nicht „neu“', () => {
    const page = (list) => buildFile({ text: '', revision: 1, revisedAt: '2026-11-01T00:00:00Z' }, list, NOW);
    const before = page([
      { code: 'OLD', firstSeen: '2026-10-01', rewards: [] },
      { code: 'KEEP', firstSeen: '2026-10-02', rewards: [] },
    ]);
    const gone = withFirstSeen([{ code: 'KEEP', rewards: [] }], before, '2026-11-06');
    assert.deepEqual(gone.removed, [{ code: 'OLD', firstSeen: '2026-10-01', removedOn: '2026-11-06' }]);
    const afterGone = buildFile({ text: '', revision: 2, revisedAt: '2026-11-06T00:00:00Z' }, gone.codes, NOW, undefined, gone.removed);
    const back = withFirstSeen(
      [
        { code: 'OLD', rewards: [] },
        { code: 'KEEP', rewards: [] },
      ],
      afterGone,
      '2026-11-20',
    );
    assert.deepEqual(
      back.codes.map((entry) => entry.firstSeen),
      ['2026-10-01', '2026-10-02'],
    );
    assert.deepEqual(back.removed, []);
    assert.deepEqual(
      withFirstSeen([], afterGone, '2026-12-06').removed.map((entry) => entry.code),
      ['KEEP', 'OLD'],
    );
    assert.deepEqual(
      withFirstSeen([], afterGone, '2026-12-07').removed.map((entry) => entry.code),
      ['KEEP'],
    );
  });

  it('auch Codes ohne Beginn (schon vor der Liste da): nach einem Revert weiter ohne firstSeen, also nicht „New“', () => {
    const before = buildFile({ text: '', revision: 1, revisedAt: '2026-11-01T00:00:00Z' }, [{ code: 'ANCIENT', rewards: [] }], NOW);
    const gone = withFirstSeen([], before, '2026-11-06');
    assert.deepEqual(gone.removed, [{ code: 'ANCIENT', removedOn: '2026-11-06' }]);
    const afterGone = readPromoCodesFile(JSON.stringify(buildFile({ text: '', revision: 2, revisedAt: '2026-11-06T00:00:00Z' }, gone.codes, NOW, undefined, gone.removed)));
    assert.deepEqual(afterGone?.removed, [{ code: 'ANCIENT', removedOn: '2026-11-06' }]);
    assert.deepEqual(withFirstSeen([{ code: 'ANCIENT', rewards: [] }], afterGone, '2026-11-08').codes, [{ code: 'ANCIENT', rewards: [] }]);
  });
});

describe('readPage', () => {
  /** Eine Zeile unter „Active Codes“ vor dem Ende der Tabelle einfügen. */
  const withRow = (row) => PAGE.replace('|r/Warframe Icon Glyph\n|\n', `|r/Warframe Icon Glyph\n|\n|-\n${row}\n`);

  it('scheitert, wenn eine Zeile eine Belohnung, aber keinen lesbaren Code hat (z. B. Code in einer Vorlage)', () => {
    assert.throws(() => readPage(withRow('|{{PromoCode|HIDDEN}}||Glyph||Event||||Hidden Glyph'), '2026-11-06'), /rewards \("Hidden Glyph"\) but no code/);
  });

  it('scheitert auch bei einem kaputten Code (ein Wort, aber kein gültiger Code)', () => {
    assert.throws(() => readPage(withRow('|CODE#1||Glyph||Event||||Hash Glyph'), '2026-11-06'), /no code the script can read/);
  });

  it('Platzhalter-Zeilen bleiben erlaubt: ohne Code und ohne Belohnung, oder mit „TBA“ in der Code-Zelle', () => {
    assert.equal(readPage(withRow('| || || || || '), '2026-11-06').codes.length, 6);
    assert.equal(readPage(withRow('|TBA||Booster||Next stream||||3 Day Credit Booster'), '2026-11-06').codes.length, 6);
  });

  it('eine Beschreibung statt eines Codes (wie 2023 „DUVIRI-(Warframe name)“) fällt mit Warnung weg, ohne Abbruch', () => {
    const page = readPage(withRow('|DUVIRI-(Warframe name)||Stuff||Pre-Duviri||||1st redeem: 3 Day Affinity Booster'), '2026-11-06');
    assert.equal(page.codes.length, 6);
    assert.equal(page.warnings.length, 1);
    assert.match(page.warnings[0] ?? '', /describes a code instead of naming one/);
  });

  it('Belohnungen nur in einer unbekannten Vorlage: Warnung statt stillem Wegfall, mit und ohne lesbaren Code', () => {
    const withCode = readPage(withRow('|HIDDENREWARD||Glyph||Event||||{{Glyph|Secret}}'), '2026-11-06');
    assert.ok(withCode.codes.some((entry) => entry.code === 'HIDDENREWARD' && entry.rewards.length === 0));
    assert.match(withCode.warnings.join('\n'), /rewards the script cannot read \(code "HIDDENREWARD"\)/);
    const without = readPage(withRow('|{{PromoCode|X}}||Glyph||Event||||{{Glyph|Secret}}'), '2026-11-06');
    assert.equal(without.codes.length, 6);
    assert.match(without.warnings.join('\n'), /rewards the script cannot read \(no code\)/);
  });

  it('scheitert bei mehr als 40 aktiven Codes', () => {
    const many = Array.from({ length: MAX_ACTIVE }, (_, index) => `|-\n|MANY${index}||Glyph||||||Glyph ${index}`).join('\n');
    assert.throws(() => readPage(withRow(many.slice(3)), '2026-11-06'), /46 active codes, more than 40/);
  });

  it('nennt die Codes unter „Inactive Codes“', () => {
    assert.ok(readPage(PAGE, '2026-11-06').inactive.has('oldcode3'));
  });
});

describe('checkVanished', () => {
  const previous = buildFile(
    { text: '', revision: 1, revisedAt: '2026-11-01T00:00:00Z' },
    ['A', 'B', 'C', 'D'].map((code) => ({ code, firstSeen: '2026-10-01', rewards: [] })),
    NOW,
  );

  it('scheitert, wenn die Mehrheit ohne Ende verschwindet und nicht unter „Inactive Codes“ steht', () => {
    assert.throws(() => checkVanished([{ code: 'A', rewards: [] }], new Set(), previous, '2026-11-06'), /3 of 4 codes left "Active Codes"/);
  });

  it('erlaubt das Verschieben nach „Inactive Codes“, abgelaufene Codes und einzelne Entfernungen', () => {
    checkVanished([{ code: 'A', rewards: [] }], new Set(['b', 'c', 'd']), previous, '2026-11-06');
    checkVanished(
      [
        { code: 'A', rewards: [] },
        { code: 'B', rewards: [] },
      ],
      new Set(),
      previous,
      '2026-11-06',
    );
    const ended = { ...previous, codes: previous.codes.map((entry) => ({ ...entry, until: '2026-11-01' })) };
    checkVanished([], new Set(), ended, '2026-11-06');
  });
});

describe('withPaths', () => {
  it('lädt die Namen nur, wenn eine Belohnung neu ist, und übernimmt Bekanntes', async () => {
    const first = fakeNames();
    const codes = [{ code: 'A', rewards: [{ text: 'Zylok' }, { text: 'Mystery' }] }];
    const resolved = await withPaths(codes, undefined, first.names, false);
    assert.deepEqual(resolved.codes[0]?.rewards, [
      {
        text: 'Zylok',
        path: '/Lotus/Weapons/Tenno/Pistols/ConclaveLeverPistol/ConclaveLeverPistol',
      },
      { text: 'Mystery' },
    ]);
    assert.equal(resolved.namesIndex, HASH);
    const previous = buildFile({ text: '', revision: 1, revisedAt: '2026-11-01T00:00:00Z' }, resolved.codes, NOW, resolved.namesIndex);
    const again = fakeNames();
    const same = await withPaths(codes, previous, again.names, false);
    assert.equal(again.calls.count, 0);
    assert.equal(same.resolved, false);
    assert.equal(same.namesIndex, HASH);
    assert.deepEqual(same.codes, resolved.codes);
  });

  it('Neuzuordnung ohne Item nur, wenn sich der Index des DE-Exports geändert hat; eine neue Belohnung lädt immer', async () => {
    const codes = [{ code: 'A', rewards: [{ text: 'Zylok' }, { text: 'Mystery' }] }];
    const previous = buildFile({ text: '', revision: 1, revisedAt: '2026-11-01T00:00:00Z' }, (await withPaths(codes, undefined, fakeNames().names, false)).codes, NOW, HASH);
    const unchanged = fakeNames();
    const rebuilt = await withPaths(codes, previous, unchanged.names, true);
    assert.deepEqual(unchanged.calls.knownHashes, [HASH]);
    assert.equal(rebuilt.resolved, false);
    const changed = fakeNames('fedcba9876543210');
    const again = await withPaths(codes, previous, changed.names, true);
    assert.equal(again.resolved, true);
    assert.equal(again.namesIndex, 'fedcba9876543210');
    const fresh = fakeNames();
    await withPaths([{ code: 'B', rewards: [{ text: 'Shiny Example Glyph' }] }], previous, fresh.names, false);
    assert.deepEqual(fresh.calls.knownHashes, [undefined]);
  });

  it('nach dem Rückfall auf plus kein Hash: Belohnungen ohne Item werden beim nächsten Lauf nachgeholt', async () => {
    const previous = buildFile({ text: '', revision: 1, revisedAt: '2026-11-01T00:00:00Z' }, [], NOW, HASH);
    const plus = async () => ({ source: 'plus', index: nameIndex([PLUS_EXPORT], PLUS_DICT) });
    const result = await withPaths([{ code: 'A', rewards: [{ text: 'Zylok' }, { text: 'Mystery' }] }], previous, plus, false);
    assert.equal(result.namesIndex, undefined);
    assert.ok(result.codes[0]?.rewards[0]?.path);
    const next = fakeNames();
    await withPaths(result.codes, buildFile({ text: '', revision: 1, revisedAt: '2026-11-01T00:00:00Z' }, result.codes, NOW), next.names, false);
    assert.deepEqual(next.calls.knownHashes, [undefined]);
  });

  it('ohne jede Namensquelle trotzdem schreiben, ohne Item (K5)', async () => {
    const none = async () => ({ source: 'none' });
    const result = await withPaths([{ code: 'A', rewards: [{ text: 'Zylok' }] }], undefined, none, false);
    assert.deepEqual(result.codes, [{ code: 'A', rewards: [{ text: 'Zylok' }] }]);
    assert.equal(result.namesIndex, undefined);
  });
});

describe('run', () => {
  it('schreibt beim ersten Lauf die Datei, die die App liest', async () => {
    const files = memoryFiles();
    const fetch = fakeFetch([]);
    const result = await run(deps(files, fetch));
    assert.deepEqual(result, {
      written: true,
      asOf: '2026-11-02',
      revision: 2001,
      codes: 6,
    });
    assert.deepEqual(fetch.urls, [API_URL]);
    const file = readPromoCodesFile(files.files.get(FILE));
    assert.equal(file?.format, 'tennodock-promo-codes');
    assert.equal(file?.license, 'CC BY-NC-SA 3.0');
    assert.equal(file?.page, 'https://wiki.warframe.com/w/Promo_Codes');
    assert.equal(file?.generatedAt, '2026-11-06T07:11:00Z');
    assert.equal(file?.namesIndex, HASH);
    assert.deepEqual(file?.codes[2], {
      code: 'BOOSTME',
      from: '2026-10-01',
      firstSeen: '2026-10-01',
      rewards: [
        {
          text: '3-day Affinity Booster',
          path: '/Lotus/Types/StoreItems/Boosters/AffinityBooster3DayStoreItem',
        },
        {
          text: 'Zylok',
          path: '/Lotus/Weapons/Tenno/Pistols/ConclaveLeverPistol/ConclaveLeverPistol',
        },
        { text: '220,000 Credits' },
      ],
    });
  });

  it('schreibt nichts und lädt keine Namen, solange sich nichts ändert, auch nicht an einem anderen Tag', async () => {
    const files = memoryFiles();
    await run(deps(files, fakeFetch([])));
    const before = files.files.get(FILE);
    const names = fakeNames();
    const result = await run(deps(files, fakeFetch([]), names.names, { now: NOW + DAY_MS }));
    assert.equal(result.written, false);
    assert.equal(names.calls.count, 0);
    assert.equal(files.files.get(FILE), before);
  });

  it('ein neuer Code bekommt den Tag des Laufs; ein abgelaufener verschwindet', async () => {
    const files = memoryFiles();
    await run(deps(files, fakeFetch([])));
    const page = PAGE.replace('|r/Warframe Icon Glyph', '|r/Warframe Icon Glyph\n|\n|-\n|FRESHCODE||Booster||Stream||||Shiny Example Glyph');
    await run(deps(files, fakeFetch([{ status: 200, text: answer(page, 2002, '2026-11-07T09:00:00Z') }]), undefined, { now: NOW + DAY_MS }));
    const file = readPromoCodesFile(files.files.get(FILE));
    assert.equal(file?.codes.find((entry) => entry.code === 'FRESHCODE')?.firstSeen, '2026-11-07');
    assert.equal(file?.codes.find((entry) => entry.code === 'SHINYGLYPH')?.firstSeen, undefined);
    await run(deps(files, fakeFetch([{ status: 200, text: answer(page, 2002, '2026-11-07T09:00:00Z') }]), undefined, { now: Date.parse('2027-06-01T00:00:00Z') }));
    assert.ok(!readPromoCodesFile(files.files.get(FILE))?.codes.some((entry) => entry.code === 'EXAMPLE2026'));
  });

  it('Vandalismus an „Active Codes“: Lauf scheitert, Datei bleibt; nach dem Revert keine Codes „neu“', async () => {
    const files = memoryFiles();
    await run(deps(files, fakeFetch([])));
    const before = files.files.get(FILE);
    const start = PAGE.indexOf('|-\n|[https://warframe.com/promocode?code=SHINYGLYPH');
    const emptied = PAGE.slice(0, start) + PAGE.slice(PAGE.indexOf('|}', start));
    await assert.rejects(run(deps(files, fakeFetch([{ status: 200, text: answer(emptied, 2005) }]), undefined, { now: NOW + DAY_MS })), /codes left "Active Codes"/);
    assert.equal(files.files.get(FILE), before);
    await run(deps(files, fakeFetch([{ status: 200, text: answer(PAGE, 2006) }]), undefined, { now: NOW + 2 * DAY_MS }));
    const after = readPromoCodesFile(files.files.get(FILE));
    assert.deepEqual(
      after?.codes.map((entry) => entry.firstSeen),
      readPromoCodesFile(before)?.codes.map((entry) => entry.firstSeen),
    );
  });

  it('wartet bei 429, 5xx und maxlag und versucht es noch zweimal', async () => {
    const waits = [];
    const fetch = fakeFetch([
      { status: 503, text: '' },
      {
        status: 200,
        text: JSON.stringify({ error: { code: 'maxlag' } }),
        retryAfter: 5,
      },
    ]);
    const result = await run(
      deps(memoryFiles(), fetch, undefined, {
        sleep: async (ms) => void waits.push(ms),
      }),
    );
    assert.equal(result.written, true);
    assert.equal(fetch.urls.length, 3);
    assert.deepEqual(waits, [10_000, 5_000]);
  });

  it('scheitert ohne lesbare Antwort oder bei kaputter Seite und lässt die Datei stehen', async () => {
    const files = memoryFiles();
    await run(deps(files, fakeFetch([])));
    const before = files.files.get(FILE);
    await assert.rejects(run(deps(files, fakeFetch([{ status: 404, text: '' }]))), /HTTP 404/);
    await assert.rejects(run(deps(files, fakeFetch([{ status: 200, text: '<html>' }]))), /Not JSON/);
    await assert.rejects(run(deps(files, fakeFetch([{ status: 200, text: answer('blanked', 2003) }]))), /No section/);
    assert.equal(files.files.get(FILE), before);
  });
});

describe('readPromoCodesFile', () => {
  it('nur das eigene Format; Einträge ohne Code oder mit kaputten Belohnungen fallen weg', () => {
    assert.equal(readPromoCodesFile('{"format":"other","v":1,"codes":[]}'), undefined);
    assert.equal(readPromoCodesFile('kaputt'), undefined);
    const file = readPromoCodesFile(
      JSON.stringify({
        format: 'tennodock-promo-codes',
        v: 1,
        codes: [
          { code: 'OK', rewards: [] },
          { code: 'has space', rewards: [] },
          { code: 'X', rewards: [1] },
          { code: 'D', firstSeen: 'gestern', rewards: [] },
        ],
      }),
    );
    assert.deepEqual(
      file?.codes.map((entry) => entry.code),
      ['OK'],
    );
    assert.equal(readPromoCodesFile(JSON.stringify({ format: 'tennodock-promo-codes', v: 1, namesIndex: '$(id)', codes: [] }))?.namesIndex, undefined);
    assert.equal(readPromoCodesFile(JSON.stringify({ format: 'tennodock-promo-codes', v: 1, namesIndex: HASH, codes: [] }))?.namesIndex, HASH);
  });
});
