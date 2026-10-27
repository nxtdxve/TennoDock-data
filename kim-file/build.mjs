// @ts-check
// Baut die KIM-Dateien (#106) im öffentlichen Daten-Repo: pro Sprache `kim/v1/<Sprache>.json` mit den Gesprächen der
// Protoframes, ihren Wahlstellen, der Chemie pro Antwort und Merkern zur Romanze. Läuft in der GitHub Action
// (Workflow `kim.yml`), von Hand mit:
//
//   node kim-file/build.mjs              neuen Stand von Sainan/warframe-kim-dialogues holen, Dateien bauen, falls neu
//   REBUILD=1 node kim-file/build.mjs    auch ohne neuen Stand neu bauen (z. B. nach einer Änderung am Skript)
//   KIM_TEXTS=none node kim-file/build.mjs  ohne Spieltexte: nur Zahlen, erste Nachricht als drei Wörter
//
// Im TennoDock-Repo liegt das Daten-Repo 1:1 unter `tools/tennodock-data/`; dort aufrufen.
//
// Quelle: Sainan/warframe-kim-dialogues (aus den Spieldateien gelesen). Das Repo hat keine Lizenz, eine Anfrage beim
// Autor läuft; die Texte gehören Digital Extremes. Abgerufen werden nur der neueste Commit und die Dateiliste über
// api.github.com, dann `data/*.json` und `dicts/<Sprache>.json` dieses Commits über raw.githubusercontent.com. Keine
// Abhängigkeiten ausser Node (ab 20). Doku: docs/pakete/106-overlay-kim.md im App-Repo.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanText, conversations, personOf } from './lib/conversations.mjs';

export const SOURCE = 'Sainan/warframe-kim-dialogues';
const BRANCH = 'senpai';
export const COMMIT_URL = `https://api.github.com/repos/${SOURCE}/commits/${BRANCH}`;
/** @param {string} sha */
export const listUrl = (sha) => `https://api.github.com/repos/${SOURCE}/contents/data?ref=${sha}`;
/** @param {string} sha @param {string} path */
export const rawUrl = (sha, path) => `https://raw.githubusercontent.com/${SOURCE}/${sha}/${path}`;
/** Sprachen der App (#106: Englisch und Deutsch). */
export const LANGUAGES = ['en', 'de'];
const USER_AGENT = 'TennoDock-data/1 (+https://github.com/nxtdxve/TennoDock-data)';
const FORMAT = 'tennodock-kim';
const VERSION = 1;
/** Plausibel ist ein Stand mit mindestens so vielen Personen und Gesprächen, und nicht viel weniger als bisher. */
const MIN_PEOPLE = 8;
const MIN_CONVERSATIONS = 200;
const MIN_SHARE_OF_PREVIOUS = 0.8;

/**
 * @typedef {{ status: number, text: string }} Response
 * @typedef {(url: string) => Promise<Response>} FetchText Wirft, wenn keine Antwort kommt.
 * @typedef {{ read(path: string): Promise<string | undefined>, write(path: string, text: string): Promise<void> }} Files
 *   Dateien relativ zum Datenordner (`kim/`).
 * @typedef {import('./lib/conversations.mjs').Conversation} Conversation
 * @typedef {Record<string, Record<string, Conversation>>} People Person (wie `dialogueId` in der App) → Kennung → Gespräch.
 * @typedef {{ format: string, v: number, lang: string, asOf: string, generatedAt: string, source: string, commit: string, texts: boolean, people: People }} KimFile
 * @typedef {{ fetchText: FetchText, files: Files, now: number, log(text: string): void, rebuild?: boolean, texts?: boolean, minPeople?: number, minConversations?: number }} RunDeps
 *   `minPeople`, `minConversations`: Untergrenzen der Prüfung (Tests mit kleinen Beispielen).
 * @typedef {{ written: boolean, commit?: string, asOf?: string }} RunResult
 */

/** @param {string} text */
function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** @param {FetchText} fetchText @param {string} url */
async function fetchJson(fetchText, url) {
  const response = await fetchText(url);
  if (response.status !== 200) throw new Error(`HTTP ${response.status} for ${url}`);
  const value = parse(response.text);
  if (value === undefined) throw new Error(`Not JSON: ${url}`);
  return value;
}

/** Bisherige Datei einer Sprache, wenn sie lesbar ist. @param {string | undefined} text @returns {KimFile | undefined} */
export function readKimFile(text) {
  const value = text === undefined ? undefined : parse(text);
  return isRecord(value) && value['format'] === FORMAT && value['v'] === VERSION && isRecord(value['people']) ? /** @type {KimFile} */ (value) : undefined;
}

/** Zahl der Gespräche. @param {People} people */
export const countConversations = (people) => Object.values(people).reduce((sum, convos) => sum + Object.keys(convos).length, 0);

/**
 * Grund, warum ein neuer Stand nicht plausibel ist, sonst `undefined`.
 * @param {People} people @param {KimFile | undefined} previous
 */
export function checkPeople(people, previous, minPeople = MIN_PEOPLE, minConversations = MIN_CONVERSATIONS) {
  const persons = Object.keys(people).length;
  const convos = countConversations(people);
  if (persons < minPeople) return `only ${persons} people`;
  if (convos < minConversations) return `only ${convos} conversations`;
  const before = previous ? countConversations(previous.people) : 0;
  if (convos < before * MIN_SHARE_OF_PREVIOUS) return `${convos} conversations, before ${before}`;
  return undefined;
}

/** Erste Nachricht ohne Spieltexte: die ersten drei Wörter, „ …“ nur, wenn mehr folgt. @param {string} first */
export const firstWords = (first) => {
  const words = first.split(' ');
  return words.length > 3 ? `${words.slice(0, 3).join(' ')} …` : first;
};

/**
 * Ohne Spieltexte (Rückfall, falls DE die Texte nicht erlaubt): keine Antworten, keine Nachricht vor der Wahl, die erste
 * Nachricht nur mit ihren ersten drei Wörtern, damit man das Gespräch erkennt.
 * @param {People} people @returns {People}
 */
export function withoutTexts(people) {
  /** @type {People} */
  const out = {};
  for (const [person, convos] of Object.entries(people)) {
    out[person] = {};
    for (const [id, convo] of Object.entries(convos)) {
      /** @type {Conversation} */
      const slim = { c: convo.c.map(({ a, af, if: condition }) => ({ a: a.map(({ t: _text, ...rest }) => rest), ...(af ? { af } : {}), ...(condition ? { if: condition } : {}) })) };
      if (convo.r !== undefined) slim.r = convo.r;
      if (convo.first) slim.first = firstWords(convo.first);
      out[person][id] = slim;
    }
  }
  return out;
}

/** @param {RunDeps} deps @returns {Promise<RunResult>} */
export async function run(deps) {
  const { fetchText, files, log } = deps;
  const texts = deps.texts ?? true;
  const head = await fetchJson(fetchText, COMMIT_URL);
  const sha = isRecord(head) && typeof head['sha'] === 'string' ? head['sha'] : undefined;
  const commit = isRecord(head) && isRecord(head['commit']) ? head['commit'] : undefined;
  const date = isRecord(commit) && isRecord(commit['committer']) ? commit['committer']['date'] : undefined;
  if (!sha || typeof date !== 'string') throw new Error('No commit in the answer of api.github.com');
  const asOf = date.slice(0, 10);

  const previous = new Map();
  for (const lang of LANGUAGES) previous.set(lang, readKimFile(await files.read(`v1/${lang}.json`)));
  const upToDate = LANGUAGES.every((lang) => previous.get(lang)?.commit === sha && previous.get(lang)?.texts === texts);
  if (upToDate && !deps.rebuild) {
    log(`KIM files up to date (${sha.slice(0, 7)}, ${asOf})`);
    return { written: false, commit: sha, asOf };
  }

  const list = await fetchJson(fetchText, listUrl(sha));
  const names = (Array.isArray(list) ? list : []).map((entry) => (isRecord(entry) ? entry['name'] : undefined)).filter((name) => typeof name === 'string' && personOf(name));
  if (names.length === 0) throw new Error('No dialogue files in the source');
  /** @type {[string, unknown][]} */
  const data = [];
  for (const name of /** @type {string[]} */ (names)) data.push([name, await fetchJson(fetchText, rawUrl(sha, `data/${name}`))]);

  // Erst alle Sprachen bauen und prüfen, dann schreiben: Kein halber Stand, wenn eine Sprache scheitert.
  /** @type {KimFile[]} */
  const built = [];
  for (const lang of LANGUAGES) {
    const dict = await fetchJson(fetchText, rawUrl(sha, `dicts/${lang}.json`));
    if (!isRecord(dict)) throw new Error(`No texts for ${lang}`);
    const text = (/** @type {string | undefined} */ tag) => (tag === undefined ? undefined : cleanText(dict[tag]));
    /** @type {People} */
    let people = {};
    for (const [name, nodes] of data) {
      const convos = conversations(nodes, text);
      const person = personOf(name);
      if (person && Object.keys(convos).length > 0) people[person] = convos;
    }
    if (!texts) people = withoutTexts(people);
    const reason = checkPeople(people, previous.get(lang), deps.minPeople, deps.minConversations);
    if (reason) throw new Error(`KIM file ${lang} not written: ${reason}`);
    built.push({ format: FORMAT, v: VERSION, lang, asOf, generatedAt: new Date(deps.now).toISOString().replace(/\.\d{3}Z$/, 'Z'), source: SOURCE, commit: sha, texts, people });
  }
  let written = false;
  for (const file of built) {
    // Ohne Änderung am Inhalt bleibt die Datei, wie sie ist (kein Commit, kein neuer ETag, kein neuer Download bei allen).
    const before = previous.get(file.lang);
    if (before && before.commit === sha && before.texts === texts && JSON.stringify(before.people) === JSON.stringify(file.people)) {
      log(`Unchanged: v1/${file.lang}.json`);
      continue;
    }
    await files.write(`v1/${file.lang}.json`, JSON.stringify(file));
    log(`Written: v1/${file.lang}.json (${Object.keys(file.people).length} people, ${countConversations(file.people)} conversations, ${sha.slice(0, 7)} of ${asOf})`);
    written = true;
  }
  return { written, commit: sha, asOf };
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

/** Abruf mit eigener Kennung und Frist; mit `GITHUB_TOKEN` (in der Action) für api.github.com angemeldet. @type {FetchText} */
export async function fetchWithAgent(url) {
  const token = process.env['GITHUB_TOKEN'];
  /** @type {Record<string, string>} */
  const headers = { 'User-Agent': USER_AGENT };
  if (token && url.startsWith('https://api.github.com/')) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(120 * 1000) });
  return { status: response.status, text: await response.text() };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const output = process.env['GITHUB_OUTPUT'];
  try {
    const result = await run({
      fetchText: fetchWithAgent,
      files: folderFiles(process.env['DATA_DIR'] ?? 'kim'),
      now: Date.now(),
      log: (text) => console.log(text),
      rebuild: ['1', 'true'].includes(process.env['REBUILD'] ?? ''),
      texts: process.env['KIM_TEXTS'] !== 'none',
    });
    if (output) await writeFile(output, `commit=${(result.commit ?? '').slice(0, 7)}\nasOf=${result.asOf ?? ''}\n`, { flag: 'a' });
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
