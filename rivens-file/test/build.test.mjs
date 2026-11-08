// Ablauf der Action (#172) ohne Netz: warframe.market, DEs Wochenwerte und Grundwerte sind erfunden, Dateien im Speicher.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSearch, outputLines, run } from '../build.mjs';
import { FILE, readFile, readState, STATE_FILE } from '../lib/file.mjs';
import { WEEKLY_URL } from '../lib/weekly.mjs';
import { ATTRIBUTES_URL, WEAPONS_URL } from '../lib/wfm.mjs';
import { ATTRIBUTES, BASE, market, NOW, searchMarket, WEAPONS, weeklyText } from './fixture.mjs';

const DAY_MS = 86_400_000;

function memoryFiles(initial = {}) {
  const files = new Map(Object.entries(initial));
  return { files, read: async (path) => files.get(path), write: async (path, text) => void files.set(path, text) };
}

/** Erfundenes Netz; `override(url)` kann eine Antwort ersetzen (oder `undefined` für keine Antwort). */
function fakeNet(override) {
  const pool = market();
  const urls = [];
  const fetchText = async (url) => {
    urls.push(url);
    const special = override?.(url, urls.length);
    if (special === 'throw') throw new Error('no answer');
    if (special) return special;
    if (url === WEEKLY_URL) return { status: 200, text: weeklyText() };
    if (url === WEAPONS_URL) return { status: 200, text: JSON.stringify(WEAPONS) };
    if (url === ATTRIBUTES_URL) return { status: 200, text: JSON.stringify(ATTRIBUTES) };
    if (url.includes('/v1/auctions/search')) return { status: 200, text: searchMarket(pool, url) };
    return { status: 404, text: '' };
  };
  return { fetchText, urls, searches: () => urls.filter((url) => url.includes('/v1/auctions/search')).length };
}

function deps(net, files, extra = {}) {
  const sleeps = [];
  return {
    sleeps,
    deps: {
      fetchText: net.fetchText,
      files,
      now: NOW,
      log: () => {},
      sleep: async (ms) => void sleeps.push(ms),
      gapMs: 8000,
      baseValues: async () => ({ index: 'ExportUpgrades_en.json!00_test', base: BASE }),
      ...extra,
    },
  };
}

describe('run', () => {
  it('erster Lauf: alle Waffen gesucht, Datei mit Spannen, DE-Werten und Merkzettel', async () => {
    const net = fakeNet();
    const files = memoryFiles();
    const { deps: d, sleeps } = deps(net, files);
    const result = await run(d);
    assert.equal(result.written, true);
    assert.equal(result.weapons, 3);
    assert.equal(result.wfmFailed, false);
    assert.equal(result.deStale, false);
    assert.ok(sleeps.filter((ms) => ms === 8000).length >= net.searches(), 'vor jeder Suche 8 s');
    const file = readFile(files.files.get(FILE));
    assert.ok(file);
    const idx = (tag) => file.stats.indexOf(tag);
    const key = (tags, curse) => `${tags.map(idx).sort((a, b) => a - b).join('.')}|${curse}`;
    const rifle = file.weapons['Weapons/Test/TestRifle'];
    assert.deepEqual(rifle.de, [300, 100, 40, 80]);
    assert.equal(rifle.at, '2026-11-09');
    assert.equal(rifle.pairs.length, 6);
    // krit. Chance + krit. Schaden ohne Nachteil: 30 frische plus Witzpreis (fällt weg), die 36 alten zählen nicht.
    const plain = rifle.c[key(['WeaponCritChanceMod', 'WeaponCritDamageMod'], 'n')];
    assert.equal(plain[2], 30);
    assert.ok(Array.isArray(plain[3]));
    // Mit Mehrfachschuss und harmlosem Nachteil: 60, mit Glücks-Fenstern.
    const three = rifle.c[key(['WeaponCritChanceMod', 'WeaponCritDamageMod', 'WeaponFireIterationsMod'], 'h')];
    assert.equal(three[2], 60);
    assert.ok(three[5] && Object.keys(three[5]).length > 0);
    // Stufe 2: Paar plus beliebige dritte, harmloser bzw. schädlicher Nachteil getrennt.
    assert.equal(rifle.c[`*${key(['WeaponCritChanceMod', 'WeaponCritDamageMod'], 'h')}`][2], 60);
    assert.equal(rifle.c[`*${key(['WeaponCritChanceMod', 'WeaponCritDamageMod'], 's')}`][2], 20);
    // Nahkampf: Schaden mit dem Tag des Spiels; 6 Angebote = grobe Spanne ohne Verteilung.
    const blade = file.weapons['Weapons/Test/TestBlade'];
    assert.equal(blade.c[key(['WeaponMeleeDamageMod', 'WeaponCritChanceMod', 'WeaponCritDamageMod'], 'n')].length, 3);
    // Seltene Pistole: zwei Paare, keine Einträge (3 Angebote), DE-Wert ungerollt.
    const pistol = file.weapons['Weapons/Test/TestPistol'];
    assert.equal(pistol.pairs.length, 2);
    assert.deepEqual(pistol.c, {});
    assert.deepEqual(pistol.de, [null, null, 7.3, 1]);
    assert.ok(!files.files.get(FILE).includes('ErfundenerSpieler'));
    const state = readState(files.files.get(STATE_FILE));
    assert.deepEqual(state.big?.['Weapons/Test/TestRifle'], ['WeaponCritChanceMod+WeaponCritDamageMod']);
    assert.equal(state.weapons?.length, 3);
    assert.ok(state.base?.rifle);
    assert.match(outputLines(result), /^asOf=2026-11-09\nsearches=\d+\nweapons=3\nwfm_failed=false\nde_stale=false\n$/);
  });

  it('zweiter Lauf am selben Tag: keine Suche, nichts Neues', async () => {
    const first = memoryFiles();
    await run(deps(fakeNet(), first).deps);
    const net = fakeNet();
    const files = memoryFiles(Object.fromEntries(first.files));
    const result = await run(deps(net, files).deps);
    assert.equal(net.searches(), 0);
    assert.equal(result.written, false);
  });

  it('drei Tage später: Test Rifle geteilt nach Polarität, ohne die erste volle Suche', async () => {
    const first = memoryFiles();
    await run(deps(fakeNet(), first).deps);
    const net = fakeNet();
    const later = { ...deps(net, memoryFiles(Object.fromEntries(first.files))).deps, now: NOW + 4 * DAY_MS };
    await run(later);
    const rifleCcCd = net.urls.filter((url) => url.includes('weapon_url_name=test_rifle') && url.includes('positive_stats=critical_chance,critical_damage'));
    assert.ok(rifleCcCd.length === 3 && rifleCcCd.every((url) => url.includes('polarity=')));
  });

  it('Cloudflare (403) beendet die Suche; alte Einträge bleiben, Lauf meldet den Fehler', async () => {
    const first = memoryFiles();
    await run(deps(fakeNet(), first).deps);
    const old = readFile(first.files.get(FILE));
    const net = fakeNet((url) => (url.includes('/v1/auctions/search') ? { status: 403, text: '<html>' } : undefined));
    const files = memoryFiles(Object.fromEntries(first.files));
    const result = await run({ ...deps(net, files).deps, now: NOW + 8 * DAY_MS });
    assert.equal(result.stopped, 'blocked');
    assert.equal(result.wfmFailed, true);
    assert.equal(result.weapons, 0);
    assert.equal(net.searches(), 1);
    const file = readFile(files.files.get(FILE));
    assert.deepEqual(file?.weapons['Weapons/Test/TestRifle']?.c, old?.weapons['Weapons/Test/TestRifle']?.c);
    assert.equal(file?.weapons['Weapons/Test/TestRifle']?.at, '2026-11-09');
  });

  it('Antwort ohne Liste (Seite von Cloudflare mit 200) zählt wie gesperrt', async () => {
    const net = fakeNet((url) => (url.includes('/v1/auctions/search') ? { status: 200, text: '<html>challenge</html>' } : undefined));
    const result = await run(deps(net, memoryFiles()).deps);
    assert.equal(result.stopped, 'blocked');
    assert.equal(net.searches(), 1);
  });

  it('429: 60 s warten, einmal neu; danach weiter', async () => {
    let limited = false;
    const net = fakeNet((url) => {
      if (url.includes('/v1/auctions/search') && !limited) {
        limited = true;
        return { status: 429, text: '' };
      }
      return undefined;
    });
    const { deps: d, sleeps } = deps(net, memoryFiles());
    const result = await run(d);
    assert.ok(sleeps.includes(60_000));
    assert.equal(result.weapons, 3);
    assert.equal(result.wfmFailed, false);
  });

  it('drei gescheiterte Suchen in Folge beenden den Lauf; die Waffe behält ihren Stand', async () => {
    const net = fakeNet((url) => (url.includes('/v1/auctions/search') ? { status: 500, text: '' } : undefined));
    const result = await run(deps(net, memoryFiles()).deps);
    assert.equal(result.stopped, 'failures');
    assert.equal(net.searches(), 6, 'je eine Wiederholung');
    assert.equal(result.weapons, 0);
  });

  it('Budget: Waffen, die nicht mehr passen, warten; nie mehr Suchen als erlaubt', async () => {
    const net = fakeNet();
    // Test Rifle und Test Blade brauchen je mindestens 6, Test Pistol 2.
    const result = await run({ ...deps(net, memoryFiles()).deps, budget: 2 });
    assert.equal(net.searches(), 2);
    assert.equal(result.weapons, 1);
  });

  it('RIVENS_WFM aus: keine Anfrage an warframe.market, nur DEs Werte', async () => {
    const first = memoryFiles();
    await run(deps(fakeNet(), first).deps);
    const net = fakeNet();
    const files = memoryFiles(Object.fromEntries(first.files));
    const result = await run({ ...deps(net, files).deps, wfm: false, now: NOW + DAY_MS });
    assert.ok(net.urls.every((url) => url === WEEKLY_URL));
    assert.equal(result.wfmFailed, false);
    assert.equal(result.stopped, 'off');
    assert.equal(readFile(files.files.get(FILE))?.deAt, '2026-11-10');
  });

  it('DEs Datei fehlt: alte Werte bleiben; nach 14 Tagen meldet der Lauf es', async () => {
    const first = memoryFiles();
    await run(deps(fakeNet(), first).deps);
    const failing = (url) => (url === WEEKLY_URL ? { status: 404, text: '' } : undefined);
    const files = memoryFiles(Object.fromEntries(first.files));
    const soon = await run({ ...deps(fakeNet(failing), files).deps, now: NOW + DAY_MS });
    assert.equal(soon.deFailed, true);
    assert.equal(soon.deStale, false);
    assert.deepEqual(readFile(files.files.get(FILE))?.weapons['Weapons/Test/TestRifle']?.de, [300, 100, 40, 80]);
    const late = await run({ ...deps(fakeNet(failing), memoryFiles(Object.fromEntries(files.files))).deps, now: NOW + 15 * DAY_MS });
    assert.equal(late.deStale, true);
  });

  it('Listen von warframe.market fehlen: keine Suche, Lauf meldet den Fehler, Datei bleibt gültig', async () => {
    const net = fakeNet((url) => (url === WEAPONS_URL ? { status: 500, text: '' } : undefined));
    const files = memoryFiles();
    const result = await run(deps(net, files).deps);
    assert.equal(result.stopped, 'lists');
    assert.equal(result.wfmFailed, true);
    assert.equal(net.searches(), 0);
  });

  it('ohne Grundwerte keine Glücks-Fenster, sonst gleich', async () => {
    const files = memoryFiles();
    await run({ ...deps(fakeNet(), files).deps, baseValues: async () => Promise.reject(new Error('down')) });
    const file = readFile(files.files.get(FILE));
    const entries = Object.values(file?.weapons['Weapons/Test/TestRifle']?.c ?? {});
    assert.ok(entries.length > 0 && entries.every((entry) => entry[5] === undefined));
  });
});

describe('run: Grenzen und Schutz (Review)', () => {
  it('M1 Zeitgrenze: nach der Frist keine neue Waffe, das Erreichte und der Merkzettel werden geschrieben', async () => {
    let time = 0;
    // Jede Suche kostet eine Minute; Frist 3 Minuten.
    const net = fakeNet((url) => {
      if (url.includes('/v1/auctions/search')) time += 60_000;
      return undefined;
    });
    const files = memoryFiles();
    const result = await run({ ...deps(net, files).deps, clock: () => time, timeLimitMs: 3 * 60_000 });
    assert.equal(result.stopped, 'time');
    assert.equal(result.wfmFailed, false);
    assert.ok(result.weapons >= 1 && result.weapons < 3);
    const file = readFile(files.files.get(FILE));
    assert.equal(Object.values(file?.weapons ?? {}).filter((record) => record.at).length, result.weapons);
    assert.equal(readState(files.files.get(STATE_FILE)).day?.searches, result.searches);
  });

  it('M1 Zeitgrenze hart: auch eine laufende Waffe endet 30 min nach der Frist', async () => {
    let time = 0;
    const net = fakeNet((url) => {
      if (url.includes('/v1/auctions/search')) time += 20 * 60_000;
      return undefined;
    });
    const result = await run({ ...deps(net, memoryFiles()).deps, clock: () => time, timeLimitMs: 30 * 60_000 });
    assert.equal(result.stopped, 'time');
    assert.ok(net.searches() <= 3);
  });

  it('M1 Rate-Limit: nach 5 Antworten mit 429 Schluss, der Lauf meldet es', async () => {
    const net = fakeNet((url) => (url.includes('/v1/auctions/search') ? { status: 429, text: '' } : undefined));
    const result = await run(deps(net, memoryFiles()).deps);
    assert.equal(result.stopped, 'limited');
    assert.equal(result.wfmFailed, true);
    assert.equal(net.searches(), 5);
  });

  it('S1 Tageszähler: ein zweiter Lauf am selben Tag nutzt nur den Rest, am nächsten Tag gilt die Grenze neu', async () => {
    const files = memoryFiles();
    await run({ ...deps(fakeNet(), files).deps, budget: 2, dailyBudget: 4 });
    assert.deepEqual(readState(files.files.get(STATE_FILE)).day, { date: '2026-11-09', searches: 2 });
    const second = fakeNet();
    await run({ ...deps(second, files).deps, dailyBudget: 4 });
    assert.ok(second.searches() <= 2);
    const day = readState(files.files.get(STATE_FILE)).day;
    assert.ok(day && day.date === '2026-11-09' && day.searches <= 4);
    const third = fakeNet();
    await run({ ...deps(third, files).deps, dailyBudget: 4, now: NOW + DAY_MS });
    assert.equal(readState(files.files.get(STATE_FILE)).day?.date, '2026-11-10');
  });

  it('K1 viel kürzere Waffenliste: die alte bleibt', async () => {
    const first = memoryFiles();
    await run(deps(fakeNet(), first).deps);
    const short = { ...WEAPONS, data: WEAPONS.data.slice(0, 1) };
    const net = fakeNet((url) => (url === WEAPONS_URL ? { status: 200, text: JSON.stringify(short) } : undefined));
    const files = memoryFiles(Object.fromEntries(first.files));
    await run({ ...deps(net, files).deps, now: NOW + DAY_MS });
    assert.equal(readState(files.files.get(STATE_FILE)).weapons?.length, 3);
    assert.equal(Object.keys(readFile(files.files.get(FILE))?.weapons ?? {}).length, 3);
  });

  it('K2 ohne Merkzettel und ohne warframe.market: alte DE-Werte bleiben', async () => {
    const first = memoryFiles();
    await run(deps(fakeNet(), first).deps);
    const files = memoryFiles({ [FILE]: first.files.get(FILE) });
    await run({ ...deps(fakeNet(), files).deps, wfm: false, now: NOW + DAY_MS });
    assert.deepEqual(readFile(files.files.get(FILE))?.weapons['Weapons/Test/TestRifle']?.de, [300, 100, 40, 80]);
  });

  it('K8 DEs Datei ändert sich 14 Tage nicht: der Lauf meldet es', async () => {
    const files = memoryFiles();
    await run({ ...deps(fakeNet(), files).deps, wfm: false });
    const soon = await run({ ...deps(fakeNet(), files).deps, wfm: false, now: NOW + 7 * DAY_MS });
    assert.equal(soon.deStale, false);
    const late = await run({ ...deps(fakeNet(), files).deps, wfm: false, now: NOW + 15 * DAY_MS });
    assert.equal(late.deFailed, false);
    assert.equal(late.deStale, true);
  });

  it('K9 ein unerwarteter Fehler kostet nur seine Waffe', async () => {
    const files = memoryFiles();
    const log = (text) => {
      if (text.startsWith('test_rifle (')) throw new Error('kaputt');
    };
    const result = await run({ ...deps(fakeNet(), files).deps, log });
    assert.equal(result.weapons, 2);
    const file = readFile(files.files.get(FILE));
    assert.equal(file?.weapons['Weapons/Test/TestRifle']?.at, undefined);
    assert.equal(file?.weapons['Weapons/Test/TestBlade']?.at, '2026-11-09');
  });
});

describe('createSearch', () => {
  it('keine Antwort: 30 s warten, einmal neu', async () => {
    const sleeps = [];
    let calls = 0;
    const { search } = createSearch({ fetchText: async () => (calls++ === 0 ? Promise.reject(new Error('x')) : { status: 200, text: '{"payload":{"auctions":[]}}' }), sleep: async (ms) => void sleeps.push(ms), gapMs: 8000, budget: 10 });
    assert.deepEqual(await search('u'), { list: [], total: 0 });
    assert.deepEqual(sleeps, [8000, 30_000, 8000]);
  });
  it('Budget aufgebraucht: keine Anfrage mehr', async () => {
    const { search, stopped } = createSearch({ fetchText: async () => ({ status: 200, text: '{"payload":{"auctions":[]}}' }), sleep: async () => {}, gapMs: 0, budget: 1 });
    await search('u');
    assert.deepEqual(await search('u'), { failed: 'budget' });
    assert.equal(stopped(), 'budget');
  });
});
