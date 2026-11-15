// @ts-check
// Baut den Zustand aller Kosmetik ohne Fundort für TennoDock (#274) im öffentlichen Daten-Repo:
//
//   cosmetics/v1/availability.json  Pfad → Zustand und Art (`a`, `k`) für Kosmetik, der die App keinen Fundort zuordnet
//   cosmetics/v1/unknown.json       Kosmetik ohne Fundort und ohne Zustand, mit dem Tag, seit dem sie fehlt (lädt die App nie)
//   cosmetics/v1/SOURCES.md         Herkunft der Daten
//
// Läuft in der GitHub Action (Workflow `cosmetics.yml`), einmal pro Woche; von Hand: `node cosmetics-file/build.mjs`.
// Im TennoDock-Repo liegt das Daten-Repo 1:1 unter `tools/tennodock-data/`; dort aufrufen.
//
// Quellen: nur public-export-plus (GitHub, MIT): `ExportCustoms`, `ExportFlavour` (Teile, Pakete, Beschreibungen über
// `dict.en`), dazu die Dateien, aus denen die App selbst Fundorte liest (`ExportResources`, `ExportBundles`, `ExportVendors`,
// `ExportSyndicates`, `ExportChallenges`, `ExportEmailItems`, `../sources-file/lib/covered.mjs`). Was die App aus dem Wiki
// (`sources/v1/items.json`) oder für Paletten (`palettes/v1/palettes.json`) schon kennt, braucht ebenfalls keinen Eintrag.
// Den DE-Export braucht es nicht: Die App zählt nur Kosmetik, die plus kennt. Kein Wiki.
// Regeln: `lib/rules.mjs`; Ausnahmen von Hand: `exceptions.json` (geht immer vor). Keine Abhängigkeiten ausser Node (ab 22).
// Was gegenüber dem letzten Stand neu „weg“, „nur Konsole“ oder „kein Sammelstück“ ist, steht mit Namen als `::notice::` im Log
// und, über `FLAGGED_FILE`, in der Commit-Meldung der Action (Review #274 S2).
// Doku: docs/pakete/274-availability.md im App-Repo.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PLUS_BASE } from '../promo-codes-file/lib/names.mjs';
import { appSource, gameSources, notOnPcByPath } from '../sources-file/lib/covered.mjs';
import { classify, exceptionFor, readExceptions } from './lib/rules.mjs';

/** @typedef {import('./lib/rules.mjs').Cosmetic} Cosmetic @typedef {import('./lib/rules.mjs').Exception} Exception @typedef {import('./lib/rules.mjs').Availability} Availability */

export const FILES = { availability: 'v1/availability.json', unknown: 'v1/unknown.json', sources: 'v1/SOURCES.md' };
/** Dateien des Repos, aus denen die App Fundorte kennt (relativ zur Wurzel des Repos). */
export const APP_FILES = { items: 'sources/v1/items.json', palettes: 'palettes/v1/palettes.json' };
const FORMAT = { availability: 'tennodock-cosmetics-availability', unknown: 'tennodock-cosmetics-unknown' };
const VERSION = 1;
/** Dateien von public-export-plus mit ihrem Schlüssel in `GameData`. */
export const PLUS_FILES = /** @type {const} */ ({
  customs: 'ExportCustoms',
  flavour: 'ExportFlavour',
  resources: 'ExportResources',
  bundles: 'ExportBundles',
  vendors: 'ExportVendors',
  syndicates: 'ExportSyndicates',
  challenges: 'ExportChallenges',
  emails: 'ExportEmailItems',
  dict: 'dict.en',
});
/**
 * Untergrenzen: Liefert plus weniger Einträge (im November 2026: `ExportCustoms` 4'766, `ExportFlavour` rund 4'400,
 * `ExportResources` 3'524, `ExportBundles` 1'164, `ExportVendors` rund 150, `ExportSyndicates` 40, `ExportChallenges` 630,
 * `ExportEmailItems` 54, `dict.en` rund 36'000 Texte), bleiben die Dateien stehen. `entries`: so viele Einträge muss die
 * Statusdatei mindestens haben, und nie weniger als die Hälfte der bisherigen.
 */
export const MINIMUM = { customs: 2000, flavour: 2000, resources: 1500, bundles: 500, vendors: 50, syndicates: 20, challenges: 300, emails: 20, dict: 20_000, entries: 150 };
const MIN_SHARE_OF_PREVIOUS = 0.5;
/** Wurzeln der Kosmetik aus `ExportFlavour` wie `collectFlavourCosmetics` in der App (Paletten stehen in `palettes.json`). */
const FLAVOUR_ROOTS = ['/Lotus/Types/StoreItems/AvatarImages/', '/Lotus/Types/Items/Emotes/', '/Lotus/Upgrades/Skins/Liset/', '/Lotus/Types/Items/Titles/', '/Lotus/Types/Items/Ships/'];
const PALETTES = '/Lotus/Types/StoreItems/SuitCustomizations/';
const USER_AGENT = 'TennoDock-data/1 (+https://github.com/nxtdxve/TennoDock-data; weekly cosmetics availability)';

/**
 * @typedef {Record<keyof typeof PLUS_FILES, unknown>} GameData
 * @typedef {{ format: string, v: number, asOf: string, items: Record<string, Availability> }} AvailabilityFile
 * @typedef {{ format: string, v: number, asOf: string, items: Record<string, { since: string, name: string }> }} UnknownFile
 * @typedef {{ read(path: string): Promise<string | undefined>, write(path: string, text: string): Promise<void> }} Files
 * @typedef {{
 *   loadGame(): Promise<GameData>,
 *   files: Files,
 *   repo: Files,
 *   exceptions: unknown,
 *   now: number,
 *   log(text: string): void,
 *   minimum?: Partial<typeof MINIMUM>,
 * }} RunDeps `files`: Ausgabe (`cosmetics/`), `repo`: Wurzel des Repos (Fundorte der App). `minimum`: kleinere Grenzen für Tests.
 * @typedef {{ path: string, name: string, a: string, k: string }} Flagged Eintrag, der neu `gone`, `console` oder `never` ist.
 * @typedef {{ written: string[], asOf: string, entries: number, unknown: number, ok: boolean, flagged: Flagged[] }} RunResult
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** @param {unknown} value @returns {Record<string, unknown>} */
const record = (value) => (isRecord(value) ? value : {});
const day = (/** @type {number} */ now) => new Date(now).toISOString().slice(0, 10);
/** Vergleich nach Code-Einheiten: gleich in jeder Umgebung, anders als `localeCompare` (Review K4). */
const byCode = (/** @type {string} */ a, /** @type {string} */ b) => (a < b ? -1 : a > b ? 1 : 0);
/** @param {string} text */
function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
/** Pfad wie in der App: `/StoreItems/` fällt weg (nur das erste, Glyphen behalten `/Types/StoreItems/AvatarImages/`). */
const itemPath = (/** @type {string} */ path) => path.replace('/StoreItems/', '/');

/**
 * Kein Sammelstück in der App (`classify` in `kinds.ts`): Bauteile des Railjacks, Körperbau, Einstellungen, Geschosse,
 * Platzhalter-Honorias und die rechte Hälfte zweiteiliger Sentinel-Flügel.
 * @param {string} path @param {string} name @param {ReadonlySet<string>} paths
 */
function notCollected(path, name, paths) {
  const file = path.slice(path.lastIndexOf('/') + 1);
  if (path.startsWith('/Lotus/Upgrades/Skins/RailJack/') && / MK (I|II|III)$/.test(name)) return true;
  if (/\/BodyTypes\/|\/Operator\/Bodies\//.test(path) || /^Lotus\w*Customization$|^OperatorCustomization$|ProjectileSkin$/.test(file)) return true;
  if (path.startsWith('/Lotus/Types/Items/Titles/') && (name === 'Honoria' || name.endsWith(' Founder Honoria'))) return true;
  return path.startsWith('/Lotus/Upgrades/Skins/Sentinels/Wings/') && path.endsWith('Right') && paths.has(path.slice(0, -'Right'.length));
}

/**
 * Kosmetik, die zur Sammlung zählt, mit englischem Namen, Beschreibung und Paketen: `ExportCustoms` und `ExportFlavour`
 * (ohne Paletten), ohne Standard-Teile, ohne Teile, die es am PC nicht gibt, ohne Namen und ohne Nicht-Sammelstücke.
 * @param {GameData} game @returns {Cosmetic[]}
 */
export function cosmeticsOf(game) {
  const dict = record(game.dict);
  const text = (/** @type {unknown} */ key) => (typeof key === 'string' && typeof dict[key] === 'string' ? /** @type {string} */ (dict[key]) : '');
  /** @type {Map<string, Record<string, unknown>>} */
  const entries = new Map();
  for (const [path, value] of Object.entries(record(game.customs))) if (isRecord(value)) entries.set(path, value);
  for (const [path, value] of Object.entries(record(game.flavour))) if (isRecord(value) && FLAVOUR_ROOTS.some((root) => path.startsWith(root))) entries.set(path, value);
  /** @type {Map<string, string[]>} */
  const bundles = new Map();
  for (const [bundle, value] of Object.entries(record(game.bundles))) {
    for (const component of Array.isArray(record(value)['components']) ? /** @type {unknown[]} */ (record(value)['components']) : []) {
      const type = record(component)['typeName'];
      if (typeof type !== 'string') continue;
      const path = itemPath(type);
      bundles.set(path, [...(bundles.get(path) ?? []), bundle]);
    }
  }
  const paths = new Set(entries.keys());
  /** @type {Cosmetic[]} */
  const result = [];
  for (const [path, value] of entries) {
    const name = text(value['name']).trim();
    const platforms = Array.isArray(value['excludedPlatforms']) ? value['excludedPlatforms'] : [];
    if (!name || value['alwaysAvailable'] === true || platforms.includes('CP_WINDOWS') || notOnPcByPath(path) || notCollected(path, name, paths)) continue;
    result.push({ path, name, description: text(value['description']).replace(/\s+/g, ' ').trim(), bundles: bundles.get(path) ?? [] });
  }
  return result.sort((a, b) => byCode(a.path, b.path));
}

/**
 * Pfade, denen die App selbst einen Fundort gibt: Regeln aus plus (`covered.mjs`), Wiki-Fundorte und Paletten.
 * @param {GameData} game @param {readonly Cosmetic[]} cosmetics @param {{ items?: unknown, palettes?: unknown }} appFiles
 * @returns {Set<string>}
 */
export function appKnown(game, cosmetics, appFiles) {
  const names = new Map(cosmetics.map((item) => [item.path, item.name]));
  const known = gameSources({ ...game, names });
  const wiki = record(record(appFiles.items)['items']);
  const palettes = record(record(appFiles.palettes)['palettes']);
  return new Set(cosmetics.filter((item) => appSource(item.path, known, item.name) !== undefined || Object.hasOwn(wiki, item.path) || Object.hasOwn(palettes, item.path)).map((item) => item.path));
}

/** @template T @param {Record<string, T>} value @returns {Record<string, T>} */
const sortKeys = (value) => Object.fromEntries(Object.entries(value).sort(([a], [b]) => byCode(a, b)));

/** Zustände, die ein Teil aus der Liste nehmen oder grau machen: Neue Einträge damit sieht sich jemand an (Review S2). */
const FLAGGED_STATES = new Set(['gone', 'console', 'never']);

/**
 * Einträge, die gegenüber der bisherigen Datei neu `gone`, `console` oder `never` sind, mit englischem Namen (Ordner: der
 * Schlüssel). Ohne bisherige Datei keine: Den ersten Stand hat jemand im Ganzen geprüft.
 * @param {Record<string, Availability>} items @param {AvailabilityFile | undefined} previous @param {ReadonlyMap<string, string>} names
 * @returns {Flagged[]}
 */
export function newlyFlagged(items, previous, names) {
  if (!previous) return [];
  return Object.entries(items)
    .filter(([path, entry]) => FLAGGED_STATES.has(entry.a) && previous.items[path]?.a !== entry.a)
    .map(([path, entry]) => ({ path, name: names.get(path) ?? path, a: entry.a, k: entry.k }));
}

/** Name für Log und Commit-Meldung: eine Zeile, ohne Steuerzeichen, höchstens 80 Zeichen. @param {string} text */
const oneLine = (text) =>
  text
    .replace(/\p{Cc}+/gu, ' ')
    .trim()
    .slice(0, 80);

/**
 * Liste für die Commit-Meldung der Action: höchstens `limit` Einträge, der Rest steht im Log.
 * @param {readonly Flagged[]} flagged @returns {string}
 */
export function flaggedText(flagged, limit = 40) {
  if (flagged.length === 0) return '';
  const lines = flagged.slice(0, limit).map((entry) => `- ${entry.a}/${entry.k}: ${oneLine(entry.name)} (${entry.path})`);
  if (flagged.length > limit) lines.push(`- … and ${flagged.length - limit} more (see the log of the run)`);
  return [`New entries that hide a cosmetic or mark it as no longer obtainable (${flagged.length}). If one is wrong, add it to cosmetics-file/exceptions.json with "a": "unknown".`, '', ...lines, ''].join('\n');
}

/** Meldung für GitHub (`::notice::`), Sonderzeichen nach der Vorgabe für Workflow-Befehle maskiert. @param {Flagged} entry */
const notice = (entry) => `::notice::New ${entry.a}/${entry.k}: ${oneLine(entry.name).replace(/%/g, '%25')} (${entry.path})`;

/**
 * Statusdatei und Liste ohne Zustand. Ausnahmen gehen vor (Ordner-Schlüssel stehen als Ordner in der Datei), sonst die erste
 * passende Regel; Paletten nie (die stehen in `palettes.json`). `asOf` bleibt, solange sich kein Eintrag ändert.
 * @param {readonly Cosmetic[]} cosmetics @param {ReadonlySet<string>} known @param {Record<string, Exception>} exceptions
 * @param {{ availability?: AvailabilityFile, unknown?: UnknownFile }} previous @param {number} now
 * @returns {{ availability: AvailabilityFile, unknown: UnknownFile, rules: Record<string, number> }}
 */
export function buildFiles(cosmetics, known, exceptions, previous, now) {
  const today = day(now);
  /** @type {Record<string, Availability>} */
  const items = {};
  /** @type {Record<string, { since: string, name: string }>} */
  const unknown = {};
  /** @type {Record<string, number>} */
  const rules = {};
  for (const [key, exception] of Object.entries(exceptions)) if (exception.a !== 'unknown' && exception.k) items[key] = { a: exception.a, k: exception.k };
  for (const item of cosmetics) {
    if (item.path.startsWith(PALETTES)) continue;
    const exception = exceptionFor(item.path, exceptions);
    if (exception) {
      rules['exception'] = (rules['exception'] ?? 0) + 1;
      continue;
    }
    if (known.has(item.path)) continue;
    const found = classify(item);
    if (found) {
      items[item.path] = { a: found.a, k: found.k };
      rules[found.rule] = (rules[found.rule] ?? 0) + 1;
    } else unknown[item.path] = { since: previous.unknown?.items[item.path]?.since ?? today, name: item.name };
  }
  const sorted = sortKeys(items);
  const same = previous.availability !== undefined && JSON.stringify(previous.availability.items) === JSON.stringify(sorted);
  const unknownSame = previous.unknown !== undefined && JSON.stringify(previous.unknown.items) === JSON.stringify(sortKeys(unknown));
  return {
    availability: { format: FORMAT.availability, v: VERSION, asOf: same && previous.availability ? previous.availability.asOf : today, items: sorted },
    unknown: { format: FORMAT.unknown, v: VERSION, asOf: unknownSame && previous.unknown ? previous.unknown.asOf : today, items: sortKeys(unknown) },
    rules,
  };
}

/** Herkunft der Daten, im Ordner der Dateien. */
export const SOURCES_TEXT = `# Sources of cosmetics/v1

- \`availability.json\` and \`unknown.json\` are built every week by \`cosmetics-file/build.mjs\` (workflow \`cosmetics.yml\`).
- Game data: [warframe-public-export-plus](https://github.com/calamity-inc/warframe-public-export-plus) (MIT), files
  \`ExportCustoms\`, \`ExportFlavour\`, \`ExportResources\`, \`ExportBundles\`, \`ExportVendors\`, \`ExportSyndicates\`,
  \`ExportChallenges\`, \`ExportEmailItems\` and \`dict.en\` (English names and descriptions by Digital Extremes).
- States come from fixed patterns over these files (\`cosmetics-file/lib/rules.mjs\`) and from entries made by hand
  (\`cosmetics-file/exceptions.json\`, each with a note, a source link and the day it was checked).
- No content from the WARFRAME Wiki. TennoDock is not affiliated with Digital Extremes.
`;

/** Bisherige Datei, wenn Format und Version passen. @template T @param {string | undefined} text @param {string} format @returns {T | undefined} */
function previousFile(text, format) {
  const value = text === undefined ? undefined : parse(text);
  return isRecord(value) && value['format'] === format && value['v'] === VERSION && isRecord(value['items']) ? /** @type {T} */ (value) : undefined;
}

/** @param {RunDeps} deps @returns {Promise<RunResult>} */
export async function run(deps) {
  const { files, repo, log, now } = deps;
  const minimum = { ...MINIMUM, ...deps.minimum };
  const exceptions = readExceptions(deps.exceptions);
  const game = await deps.loadGame();
  const previous = {
    availability: previousFile(/** @type {string | undefined} */ (await files.read(FILES.availability)), FORMAT.availability),
    unknown: previousFile(/** @type {string | undefined} */ (await files.read(FILES.unknown)), FORMAT.unknown),
  };
  const keep = (/** @type {string} */ reason) => {
    log(`::warning::${reason}; the files stay as they are`);
    const entries = Object.keys(/** @type {AvailabilityFile | undefined} */ (previous.availability)?.items ?? {}).length;
    const unknown = Object.keys(/** @type {UnknownFile | undefined} */ (previous.unknown)?.items ?? {}).length;
    return { written: [], asOf: /** @type {AvailabilityFile | undefined} */ (previous.availability)?.asOf ?? day(now), entries, unknown, ok: false, flagged: [] };
  };
  // Liefert plus zu wenig, bleibt alles stehen: Sonst fielen Einträge weg oder die Liste ohne Zustand wüchse grundlos.
  for (const key of /** @type {(keyof typeof PLUS_FILES)[]} */ (Object.keys(PLUS_FILES))) {
    const count = Object.keys(record(game[key])).length;
    if (count < minimum[key]) return keep(`${PLUS_FILES[key]} has ${count} entries (minimum ${minimum[key]})`);
  }
  const appFiles = { items: parse((await repo.read(APP_FILES.items)) ?? ''), palettes: parse((await repo.read(APP_FILES.palettes)) ?? '') };
  if (!isRecord(appFiles.items)) log(`::warning::${APP_FILES.items} not readable; wiki sources are not subtracted`);
  if (!isRecord(appFiles.palettes)) log(`::warning::${APP_FILES.palettes} not readable`);
  const cosmetics = cosmeticsOf(game);
  const built = buildFiles(cosmetics, appKnown(game, cosmetics, appFiles), exceptions, /** @type {never} */ (previous), now);
  const entries = Object.keys(built.availability.items).length;
  const before = previous.availability ? Object.keys(/** @type {AvailabilityFile} */ (previous.availability).items).length : undefined;
  if (entries < minimum.entries || (before !== undefined && entries < before * MIN_SHARE_OF_PREVIOUS)) return keep(`Only ${entries} entries${before === undefined ? '' : `, before ${before}`}`);
  log(`Rules: ${Object.entries(built.rules).map(([rule, count]) => `${rule} ${count}`).join(', ')}`);
  // Neu „weg“, „nur Konsole“ oder „kein Sammelstück“ mit Namen ins Log und in die Commit-Meldung (Review S2): So fällt ein Teil
  // eines wiederkehrenden Events auf, bevor es still „weg“ ist.
  const names = new Map(cosmetics.map((item) => [item.path, item.name]));
  const flagged = newlyFlagged(built.availability.items, /** @type {AvailabilityFile | undefined} */ (previous.availability), names);
  if (!previous.availability) log('First build: no earlier file to compare new entries with');
  for (const entry of flagged) log(notice(entry));
  /** @type {string[]} */
  const written = [];
  const write = async (/** @type {string} */ path, /** @type {string} */ text) => {
    if ((await files.read(path)) === text) return;
    await files.write(path, text);
    written.push(path);
  };
  await write(FILES.availability, `${JSON.stringify(built.availability)}\n`);
  await write(FILES.unknown, `${JSON.stringify(built.unknown, null, 1)}\n`);
  await write(FILES.sources, SOURCES_TEXT);
  const unknown = Object.keys(built.unknown.items).length;
  log(`${written.length > 0 ? `Written: ${written.join(', ')}` : 'Cosmetics up to date'} (${entries} entries, ${unknown} without a state)`);
  return { written, asOf: built.availability.asOf, entries, unknown, ok: true, flagged };
}

/**
 * Ausgaben des Schritts für `GITHUB_OUTPUT` (Commit-Meldung), streng geprüft; der Workflow übergibt sie nur über `env:`.
 * @param {RunResult} result @returns {string}
 */
export function outputLines(result) {
  const { asOf, entries, unknown } = result;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || ![entries, unknown].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error('Unexpected values for the step outputs');
  return `asOf=${asOf}\nentries=${entries}\nunknown=${unknown}\n`;
}

/**
 * Bericht für das Issue des Monats: Teile ohne Zustand, die seit dem Stichtag dazugekommen sind.
 * @param {UnknownFile} unknown @param {string} from @returns {string}
 */
export function unknownReport(unknown, from) {
  const fresh = Object.entries(unknown.items).filter(([, entry]) => entry.since >= from);
  if (fresh.length === 0) return '';
  return [`Cosmetics without a source or state since ${from} (${fresh.length}):`, '', ...fresh.map(([path, entry]) => `- ${entry.name} (\`${path}\`)`), ''].join('\n');
}

/** Dateien im Ordner `root`. @param {string} root @returns {Files} */
export function folderFiles(root) {
  return {
    read: (path) => readFile(join(root, path), 'utf8').catch(() => undefined),
    async write(path, text) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    },
  };
}

/** Dateien von public-export-plus, je ein Abruf (rund 16 MB pro Lauf, nur in der Action). @returns {Promise<GameData>} */
export async function loadGameData() {
  const entries = await Promise.all(
    Object.entries(PLUS_FILES).map(async ([key, name]) => {
      const response = await fetch(`${PLUS_BASE}${name}.json`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(180 * 1000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${name}`);
      return [key, JSON.parse(await response.text())];
    }),
  );
  return /** @type {GameData} */ (Object.fromEntries(entries));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const output = process.env['GITHUB_OUTPUT'];
  const log = (/** @type {string} */ text) => console.log(text);
  const root = process.env['REPO_DIR'] ?? '.';
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const exceptions = JSON.parse(await readFile(join(here, 'exceptions.json'), 'utf8'));
    const result = await run({ loadGame: loadGameData, files: folderFiles(join(root, 'cosmetics')), repo: folderFiles(root), exceptions, now: Date.now(), log });
    if (output) await writeFile(output, outputLines(result), { flag: 'a' });
    // Liste neuer „weg“-, „nur Konsole“- und „kein Sammelstück“-Einträge für die Commit-Meldung (leer: keine).
    const flaggedFile = process.env['FLAGGED_FILE'];
    if (flaggedFile) await writeFile(flaggedFile, flaggedText(result.flagged));
    const report = process.env['REPORT_FILE'];
    const from = process.env['REPORT_FROM'];
    if (report && from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
      const unknown = previousFile(await readFile(join(root, 'cosmetics', FILES.unknown), 'utf8').catch(() => undefined), FORMAT.unknown);
      await writeFile(report, unknown ? unknownReport(/** @type {UnknownFile} */ (unknown), from) : '');
    }
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
