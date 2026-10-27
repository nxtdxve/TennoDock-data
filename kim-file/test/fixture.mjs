// Erfundene Gesprächsdatei für die Tests (#106), im Format von Sainan/warframe-kim-dialogues. Keine Texte aus dem Spiel.

const T = '/EE/Types/Engine/';
const node = (type, Id, fields = {}) => ({ type: `${T}${type}`, Id, Incoming: [], GraphPos: [0, 0], ...fields });
const line = (Id, LocTag, Outgoing) => node('DialogueNode', Id, { LocTag, Outgoing, Speaker: 'Testa' });
const choice = (Id, LocTag, Outgoing) => node('PlayerChoiceDialogueNode', Id, { LocTag, Outgoing });
const chem = (Id, ChemistryDelta, Outgoing) => node('ChemistryDialogueNode', Id, { ChemistryDelta, Outgoing });
const setBool = (Id, Content, Outgoing) => node('SetBooleanDialogueNode', Id, { Content, Outgoing });
const check = (Id, Content, TrueNodes, FalseNodes) => node('CheckBooleanDialogueNode', Id, { Content, TrueNodes, FalseNodes });
const start = (Id, Content, Outgoing) => node('StartDialogueNode', Id, { Content, Outgoing });
const end = (Id) => node('EndDialogueNode', Id);

/** Gespräch 1 (Rang 2): drei Wahlstellen, die zweite nur nach „Sure“, die dritte nur mit einem fremden Merker. */
export const TESTA = [
  start(1, 'TestaRank2Convo1', [2]),
  line(2, 'L/hello', [3, 4]),
  choice(3, 'L/sure', [5]),
  choice(4, 'L/no', [6]),
  chem(5, 10, [7]),
  setBool(6, 'TestaNoDate', [20]),
  line(7, 'L/what', [8, 9]),
  choice(8, 'L/a', [10]),
  choice(9, 'L/missing', [17]),
  check(10, 'TestaLikesCats', [11], [20]),
  line(11, 'L/cats', [12, 13]),
  choice(12, 'L/yes', [16]),
  choice(13, 'L/nope', [20]),
  setBool(16, 'TestaDating', [20]),
  check(17, 'TestaOther', [18], [19]),
  chem(18, 20, [20]),
  chem(19, 5, [20]),
  end(20),
  // Gespräch 2 (Rang 3): Wahlstelle ohne eigene Nachricht, danach eine Prüfung auf einen eigenen Merker.
  start(30, 'TestaRank3Convo1', [31]),
  line(31, 'L/old', [32]),
  { ...setBool(32, 'TestaFlag', [33, 34]), Incoming: [31] },
  choice(33, 'L/a', [35]),
  choice(34, 'L/b', [20]),
  check(35, 'TestaFlag', [36], [20]),
  line(36, 'L/own', [37, 38]),
  choice(37, 'L/yes', [20]),
  choice(38, 'L/nope', [20]),
  // Geburtstagsgruss (fällt weg) und ein Gespräch mit nur einer Antwort pro Stelle (bleibt, ohne Wahl).
  start(40, 'TestaBirthdayConvo1', [41]),
  line(41, 'L/hello', [42, 43]),
  choice(42, 'L/a', [20]),
  choice(43, 'L/b', [20]),
  start(50, 'TestaSpecial', [51]),
  line(51, 'L/hello', [52]),
  choice(52, 'L/a', [20]),
];

/** Texte wie in `dicts/en.json`; `L/missing` fehlt absichtlich. */
export const DICT = {
  'L/hello': '<RETRO_EMOJI_HEART>  hey   there',
  'L/sure': 'Sure.',
  'L/no': 'No.',
  'L/what': 'What next?',
  'L/a': 'A',
  'L/b': 'B',
  'L/cats': 'Cats?',
  'L/yes': 'Yes',
  'L/nope': 'Nope',
  'L/old': 'Old line',
  'L/own': 'Own check',
};

/** Gruppenchat ohne Chemie: keine Gespräche. */
export const GROUP = [start(1, 'HexRankUpTo2', [2]), line(2, 'L/hello', [3, 4]), choice(3, 'L/a', [5]), choice(4, 'L/b', [5]), end(5)];
