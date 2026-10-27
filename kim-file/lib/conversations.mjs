// @ts-check
// KIM-Gespräche (#106): aus dem Gesprächsgraphen einer Person (Datei `data/<Person>Dialogue_rom.dialogue.json` in
// Sainan/warframe-kim-dialogues) die Wahlstellen mit Antworten, Chemie und Warnungen. Reine Funktionen, kein Netz.
// Doku: docs/pakete/106-overlay-kim.md im App-Repo, Format: README.md, „KIM conversations“.
//
// Begriffe: Ein Gespräch beginnt an einem `StartDialogueNode` (`Content` = Kennung wie in `Completed[].Id` des
// Spielstands). Eine Wahlstelle ist ein Knoten mit mindestens zwei `PlayerChoiceDialogueNode` als Nachfolger. Was eine
// Antwort bringt, steht zwischen ihr und der nächsten Wahlstelle: Chemie (`ChemistryDialogueNode`) und Merker
// (`SetBooleanDialogueNode`, z. B. `ArthurNoDate`).

/**
 * @typedef {{ type: string, Id: number, Incoming?: number[], Outgoing?: number[], TrueNodes?: number[], FalseNodes?: number[], Outputs?: { Outgoing?: number[] }[], LocTag?: string, Content?: unknown, ChemistryDelta?: number }} DialogueNode
 * @typedef {(locTag: string | undefined) => string | undefined} Text Text zu einem `LocTag`, schon bereinigt.
 * @typedef {{ t?: string, c?: number, m?: number, f?: string }} Answer `t` Text, `c` Chemie bis zur nächsten Wahl,
 *   höchster Wert über alle Zweige (fehlt bei 0), `m` niedrigster Wert, nur wenn er kleiner ist (Zweig hängt an einem
 *   Merker), `f` Merker zur Romanze: `n` schliesst sie aus, `d` beginnt sie (abgeleitet aus den Namen, z. B.
 *   `AoiNoDate`; `SetBooleanDialogueNode` setzt immer auf wahr, zurück setzt ein eigener Knotentyp). Ob eine Antwort das
 *   Gespräch früh beendet, lässt sich aus dem Graphen nicht sicher lesen (zu viele Zweige enden ohne weitere Wahl);
 *   dafür gibt es keine Marke.
 * @typedef {{ p?: string, a: Answer[], af?: [number, number[]], if?: [string, boolean] }} Choice `p` Nachricht davor,
 *   `af` nur nach diesen Antworten (Index der Wahlstelle, Antworten), `if` nur mit diesem Merker aus früheren Gesprächen.
 * @typedef {{ r?: number, first?: string, c: Choice[] }} Conversation `r` Rang aus der Kennung (`…Rank3Convo2`), `first`
 *   erste Nachricht.
 */

const SHORT = (/** @type {string} */ type) => type.slice(type.lastIndexOf('/') + 1);
const CHOICE = 'PlayerChoiceDialogueNode';
const LINE = 'DialogueNode';
const START = 'StartDialogueNode';
const END = 'EndDialogueNode';
const CHEMISTRY = 'ChemistryDialogueNode';
const SET_BOOLEAN = 'SetBooleanDialogueNode';
const CHECK_BOOLEAN = 'CheckBooleanDialogueNode';

/** Merker, die eine Romanze ausschliessen bzw. beginnen (Namen aus den Daten, z. B. `AoiNoDate`, `AoiDating`). */
const NO_DATE = /(NoDate|DealNo)$/;
const DATE = /(Dating|WillDate|DatingDeal)$/;
/** Geburtstagsgrüsse kommen über den Kalender, nicht als Chat des Tages. */
const SKIPPED = /Birthday/;
/** Längere Nachrichten vor einer Wahl und erste Nachrichten werden gekürzt (Overlay, Grösse der Datei). */
export const MAX_LINE = 160;
/** So weit zurück sucht die Wahlstelle ihre Nachricht, wenn sie selbst keine ist (z. B. nach einem Chemie-Knoten). */
const PROMPT_DEPTH = 6;

/** Rang aus der Kennung: `ArthurRank3Convo2` → 3. @param {string} id */
export function rankOf(id) {
  const match = /Rank(\d+)Convo/.exec(id);
  return match ? Number(match[1]) : undefined;
}

/**
 * Text fürs Overlay: Emoji-Platzhalter wie `<RETRO_EMOJI_HEART>` und andere Marken fallen weg, Leerraum wird zu einem
 * Leerzeichen. Leer heisst kein Text.
 * @param {unknown} text
 */
export function cleanText(text) {
  if (typeof text !== 'string') return undefined;
  const clean = text.replace(/<[^<>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return clean === '' ? undefined : clean;
}

/** Auf `max` Zeichen kürzen, am Wortende, mit „…“. @param {string | undefined} text @param {number} [max] */
export function shorten(text, max = MAX_LINE) {
  if (text === undefined || text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** @param {DialogueNode} node @returns {number[]} */
function next(node) {
  return [...(node.Outgoing ?? []), ...(node.TrueNodes ?? []), ...(node.FalseNodes ?? []), ...(node.Outputs ?? []).flatMap((output) => output.Outgoing ?? [])];
}

/** @param {DialogueNode[]} nodes */
function graph(nodes) {
  /** @type {Map<number, DialogueNode>} */
  const byId = new Map();
  for (const node of nodes) if (typeof node?.Id === 'number' && typeof node.type === 'string') byId.set(node.Id, node);
  const type = (/** @type {number} */ id) => SHORT(byId.get(id)?.type ?? '');
  /** Antworten einer Wahlstelle, in der Reihenfolge der Daten (= im Spiel, abgeleitet). */
  const choicesOf = (/** @type {number} */ id) => next(byId.get(id) ?? /** @type {DialogueNode} */ ({ type: '', Id: id })).filter((n) => type(n) === CHOICE);
  const isDecision = (/** @type {number} */ id) => choicesOf(id).length >= 2;
  return { byId, type, choicesOf, isDecision };
}

/**
 * Was eine Antwort bis zur nächsten Wahlstelle bringt: niedrigste und höchste Chemie über alle Wege (Zweige an Merkern)
 * und die gesetzten Merker.
 * @param {ReturnType<typeof graph>} g
 * @param {number} answer
 */
function outcome(g, answer) {
  /** @type {Map<number, [number, number]>} */
  const known = new Map();
  const booleans = new Set();
  /** @param {number} id @param {Set<number>} path @returns {[number, number]} */
  const walk = (id, path) => {
    if (path.has(id)) return [0, 0];
    const cached = known.get(id);
    if (cached) return cached;
    const node = g.byId.get(id);
    if (!node || (id !== answer && g.isDecision(id))) return [0, 0];
    const type = SHORT(node.type);
    if (type === SET_BOOLEAN && typeof node.Content === 'string') booleans.add(node.Content);
    const own = type === CHEMISTRY && typeof node.ChemistryDelta === 'number' && node.ChemistryDelta > 0 ? node.ChemistryDelta : 0;
    path.add(id);
    const after = next(node).map((n) => walk(n, path));
    path.delete(id);
    /** @type {[number, number]} */
    const range = after.length === 0 ? [own, own] : [own + Math.min(...after.map((r) => r[0])), own + Math.max(...after.map((r) => r[1]))];
    known.set(id, range);
    return range;
  };
  const [min, max] = walk(answer, new Set());
  return { min, max, booleans: [...booleans] };
}

/**
 * Nachricht vor einer Wahlstelle: ihr eigener Text, sonst die nächste Nachricht davor (rückwärts über `Incoming`).
 * @param {ReturnType<typeof graph>} g @param {number} decision @param {Text} text
 */
function promptOf(g, decision, text) {
  let level = [decision];
  const seen = new Set(level);
  for (let depth = 0; depth <= PROMPT_DEPTH && level.length > 0; depth++) {
    for (const id of level) {
      const node = g.byId.get(id);
      const line = node && SHORT(node.type) === LINE ? text(node.LocTag) : undefined;
      if (line) return line;
    }
    level = level.flatMap((id) => g.byId.get(id)?.Incoming ?? []).filter((id) => !seen.has(id) && seen.add(id));
  }
  return undefined;
}

/** Alle Knoten, die von `start` aus erreichbar sind, in Reihenfolge der Breitensuche. @param {ReturnType<typeof graph>} g @param {number} start */
function reachable(g, start) {
  const order = [start];
  const seen = new Set(order);
  for (let i = 0; i < order.length; i++) {
    const node = g.byId.get(/** @type {number} */ (order[i]));
    for (const n of node ? next(node) : []) {
      if (!seen.has(n) && g.byId.has(n)) {
        seen.add(n);
        order.push(n);
      }
    }
  }
  return order;
}

/**
 * Ein Gespräch ab seinem Startknoten.
 * @param {DialogueNode[]} nodes Alle Knoten der Datei.
 * @param {number} startId
 * @param {Text} text
 * @returns {Conversation}
 */
export function conversation(nodes, startId, text) {
  const g = graph(nodes);
  return conversationIn(g, startId, text);
}

/** @param {ReturnType<typeof graph>} g @param {number} startId @param {Text} text @returns {Conversation} */
function conversationIn(g, startId, text) {
  const order = reachable(g, startId);
  const id = String(g.byId.get(startId)?.Content ?? '');
  const firstLine = order.find((n) => g.type(n) === LINE && text(g.byId.get(n)?.LocTag) !== undefined);
  const decisions = order.filter((n) => g.isDecision(n));
  const index = new Map(decisions.map((d, i) => [d, i]));
  // Merker, die dieses Gespräch selbst setzt: Eine Prüfung darauf hängt an einer Antwort hier, nicht an früheren Chats.
  const ownBooleans = new Set(order.map((n) => g.byId.get(n)).filter((n) => n && SHORT(n.type) === SET_BOOLEAN).map((n) => n?.Content));

  /** @type {Map<number, Set<number>>} Wahlstellen, die von einem Knoten aus erreichbar sind (ohne ihn selbst). */
  const reach = new Map();
  for (const n of order) reach.set(n, new Set(reachable(g, n).slice(1).filter((m) => index.has(m))));
  const reachFrom = (/** @type {number} */ n) => new Set([...(index.has(n) ? [n] : []), ...(reach.get(n) ?? [])]);

  /** @type {Choice[]} */
  const choices = decisions.map((decision) => {
    const node = g.byId.get(decision);
    const answers = g.choicesOf(decision);
    /** @type {Choice} */
    const choice = {
      a: answers.map((answer) => {
        const r = outcome(g, answer);
        const flags = (r.booleans.some((b) => NO_DATE.test(b)) ? 'n' : '') + (r.booleans.some((b) => DATE.test(b) && !NO_DATE.test(b)) ? 'd' : '');
        /** @type {Answer} */
        const out = {};
        const t = text(g.byId.get(answer)?.LocTag);
        if (t) out.t = t;
        if (r.max > 0) out.c = r.max;
        if (r.min < r.max) out.m = r.min;
        if (flags) out.f = flags;
        return out;
      }),
    };
    const prompt = shorten(promptOf(g, decision, text));
    if (prompt) choice.p = prompt;

    // Bedingungen: die nächste Wahlstelle davor, von der nicht jede Antwort hierher führt, und der nächste Merker aus
    // einem früheren Gespräch, von dem nur ein Zweig hierher führt.
    for (let i = (index.get(decision) ?? 0) - 1; i >= 0 && !choice.af; i--) {
      const before = /** @type {number} */ (decisions[i]);
      if (!reach.get(before)?.has(decision)) continue;
      const via = g.choicesOf(before).map((answer, j) => (reachFrom(answer).has(decision) ? j : -1)).filter((j) => j >= 0);
      if (via.length > 0 && via.length < g.choicesOf(before).length) choice.af = [i, via];
    }
    for (let i = order.indexOf(decision) - 1; i >= 0 && !choice.if; i--) {
      const check = g.byId.get(/** @type {number} */ (order[i]));
      if (!check || SHORT(check.type) !== CHECK_BOOLEAN || typeof check.Content !== 'string' || ownBooleans.has(check.Content)) continue;
      const yes = (check.TrueNodes ?? []).some((n) => reachFrom(n).has(decision));
      const no = (check.FalseNodes ?? []).some((n) => reachFrom(n).has(decision));
      if (yes !== no) choice.if = [check.Content, yes];
    }
    return choice;
  });

  /** @type {Conversation} */
  const result = { c: choices };
  const rank = rankOf(id);
  if (rank !== undefined) result.r = rank;
  const first = firstLine === undefined ? undefined : shorten(text(g.byId.get(firstLine)?.LocTag));
  if (first) result.first = first;
  return result;
}

/**
 * Alle Gespräche einer Datei, Schlüssel = Kennung. Ohne Chemie-Knoten (Gruppenchat, Loid, Einführungen) leer;
 * Geburtstagsgrüsse fehlen. Gespräche ohne Wahl stehen mit leerer Liste drin: Die App zählt sie zu den möglichen.
 * @param {unknown} data Inhalt der Datei unter `data/`.
 * @param {Text} text
 * @returns {Record<string, Conversation>}
 */
export function conversations(data, text) {
  if (!Array.isArray(data)) return {};
  const nodes = /** @type {DialogueNode[]} */ (data.filter((node) => typeof node === 'object' && node !== null));
  if (!nodes.some((node) => SHORT(String(node.type)) === CHEMISTRY)) return {};
  const g = graph(nodes);
  /** @type {Record<string, Conversation>} */
  const out = {};
  for (const node of nodes) {
    if (SHORT(node.type) !== START || typeof node.Content !== 'string' || node.Content === '' || SKIPPED.test(node.Content)) continue;
    out[node.Content] = conversationIn(g, node.Id, text);
  }
  return out;
}

/** Kennung der Person aus dem Dateinamen: `JabirDialogue_rom.dialogue.json` → `Jabir` (wie `dialogueId` in der App). @param {string} file */
export function personOf(file) {
  const match = /^([A-Za-z0-9_]+)Dialogue_rom\.dialogue\.json$/.exec(file);
  return match ? match[1] : undefined;
}

// Für Tests und das Skript.
export const NODE_TYPES = { CHOICE, LINE, START, END, CHEMISTRY, SET_BOOLEAN, CHECK_BOOLEAN };
