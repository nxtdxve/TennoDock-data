// @ts-check
// Zustand von Kosmetik ohne Fundort (#274): feste Muster aus Pfad, englischem Namen, Paket und DE-Beschreibung (alles aus
// public-export-plus, `dict.en`). Was die App selbst zuordnet (`../../sources-file/lib/covered.mjs`, Wiki-Fundorte aus
// `sources/v1/items.json`, Paletten aus `palettes/v1/palettes.json`), braucht keinen Eintrag. Kein Wiki: Die Muster stammen
// aus den Spieldaten; die Recherche dazu steht in docs/research/unknown-sources.md und docs/pakete/274-availability.md im
// App-Repo. Reine Funktionen ohne Abhängigkeiten.

/** Zustände: jetzt (über einen Weg, den die App nicht kennt), kommt wieder, weg, nur Konsole, kein Sammelstück. */
export const STATES = /** @type {const} */ (['now', 'limited', 'gone', 'console', 'never']);
/** Arten (Grund oder Weg); Apps schreiben den Text selbst. Unbekannte Werte lesen sie als „unbekannt“. */
export const KINDS = /** @type {const} */ ([
  // now
  'genetic',
  'accolade',
  'coda',
  'kuvaLich',
  'sisters',
  'tribute',
  // limited
  'seasonal',
  'anniversary',
  'conquera',
  'moframe',
  'baro',
  'event',
  // gone
  'operation',
  'promo',
  'partner',
  'convention',
  'twitch',
  'retired',
  // console, never
  'console',
  'cut',
  'personal',
  'special',
]);

/**
 * @typedef {(typeof STATES)[number]} State
 * @typedef {(typeof KINDS)[number]} Kind
 * @typedef {{ a: State, k: Kind }} Availability
 * @typedef {{ path: string, name: string, description: string, bundles: readonly string[] }} Cosmetic
 *   `bundles`: Pfade der Pakete aus `ExportBundles`, in denen das Teil steckt.
 * @typedef {{ id: string, a: State, k: Kind | ((item: Cosmetic) => Kind), test: (item: Cosmetic) => boolean }} Rule
 */

const file = (/** @type {string} */ path) => path.slice(path.lastIndexOf('/') + 1);
const inFolder = (/** @type {Cosmetic} */ item, /** @type {RegExp} */ folder) => folder.test(item.path.slice(0, item.path.lastIndexOf('/') + 1));
const inBundle = (/** @type {Cosmetic} */ item, /** @type {RegExp} */ pattern) => item.bundles.some((bundle) => pattern.test(file(bundle)));

/** Konsolen-Pakete: Jade (Xbox, Prestige Packs), Opal (Switch, Esteem Packs), Obsidian und Okina (PlayStation). */
const CONSOLE_BUNDLES = /^(PrestigePack|NintendoEsteemPack|NintendoSkinPack|ExcaliburXBonePack|JadeAxaArmourBundle|PS4|PS5|Sony)/;
const CONSOLE_FOLDERS = /\/(Promo\/Microsoft|Promo\/Nintendo|Armor\/Microsoft|AvatarImages\/Sony)\/$/;
const CONSOLE_NAMES = /\b(Opal|Obsidian|Okina)\b|\bJade (Skin|Helmet)$|^Jade \w+ Sugatra$/;
/** Feste und Pakete zu Festen; der Markt verkauft sie zum Fest, nicht jedes Jahr dasselbe. */
const SEASONAL_BUNDLES = /^(Halloween|Winter|Xmas|XMas|Solstice|Valentine|LNY|LunarNewYear|CNY|Easter|Summer|CandyCane|DesertCamo)/;
const SEASONAL_FOLDERS = /\/(Halloween|WinterSolstice|SummerSolstice|LunarNewYear|Festivities|AvatarImages\/Seasonal|Promo\/Seasonal)\/$/;
const SEASONAL_NAMES = /\b(Day of the Dead|Solstice|Lunaeus|Lunar Renewal|Festive|Towsun|Calavera|Donwyn)\b/;
/** Baro Ki'Teer: sein Angebot wechselt, Teile kommen wieder. */
const BARO_NAMES = /Ki['’]Teer|\bElixis\b|\bEskhatos\b|^(Left |Right )?Prisma /i;
/** DE-Beschreibungen vergangener Events und Operationen. */
const DURING = /\b(during|participated in|contributions? (to|they made during)|veterans of|performance in)\b/i;
const AWARDED_TO = /\bawarded (to )?(all )?(those|the Tenno|Tenno) who (helped|fought|hunted|stood|participated)/i;

/** @type {readonly Rule[]} Reihenfolge zählt: Die erste passende Regel gilt. */
export const RULES = [
  // Kein Sammelstück: persönliche Glyphen der TennoCon-Legendary-Tickets, Ranglisten-Embleme der Clans, gestrichene Embleme.
  { id: 'legendary', a: 'never', k: 'personal', test: (item) => item.path.includes('/AvatarImages/') && /\bLegendary\b/.test(item.name) },
  { id: 'cut', a: 'never', k: 'cut', test: (item) => /^(LeaderBadge\w+Item|ZawVariantBadgeItem[A-Z]|PvpRepBadgeItem)$/.test(file(item.path)) },
  // Embleme für Rollen (TennoGen, Übersetzer, Chronist, Guides of the Lotus): DE vergibt sie weiter an Leute in der Rolle; für
  // alle anderen kein Sammelstück (Daves Entscheidung vom 15.11.2026, Review #274 S1).
  { id: 'special', a: 'never', k: 'special', test: (item) => /\bworn only by a select few\b/i.test(item.description) || /\bassist the Lotus\b/.test(item.description) },
  // Nur auf Konsolen
  {
    id: 'console',
    a: 'console',
    k: 'console',
    test: (item) => inBundle(item, CONSOLE_BUNDLES) || inFolder(item, CONSOLE_FOLDERS) || CONSOLE_NAMES.test(item.name) || /Action(Nintendo|Sony|Xbox)$/.test(file(item.path)),
  },
  // Jederzeit, über einen Weg, den die App nicht aus Daten kennt
  { id: 'accolade', a: 'now', k: 'accolade', test: (item) => item.name.endsWith(' Accolade Glyph') },
  {
    id: 'genetic',
    a: 'now',
    k: 'genetic',
    test: (item) => /\/(KubrowPet|CatbrowPet)\/Patterns\//.test(item.path) && item.bundles.length === 0 && item.name.endsWith(' Fur Pattern') && !/\b(Vasca|Helminth)\b/.test(item.name),
  },
  { id: 'coda', a: 'now', k: 'coda', test: (item) => /\bTechnocyte Coda\b/.test(item.description) },
  { id: 'kuvaLich', a: 'now', k: 'kuvaLich', test: (item) => /\bKuva Lich\b/.test(item.description) && item.path.includes('/Clan/') },
  { id: 'sisters', a: 'now', k: 'sisters', test: (item) => /\bSisters of Parvos\b/.test(item.description) && item.path.includes('/Clan/') },
  { id: 'tribute', a: 'now', k: 'tribute', test: (item) => /^Login\d+/.test(file(item.path)) || inBundle(item, /^Login(Pack[A-Z]|\d+Pack)$/) || /\bThousand Days\b/.test(item.name) },
  // Kommt wieder
  { id: 'conquera', a: 'limited', k: 'conquera', test: (item) => /Conquera|CharityRibbon|QTCC/i.test(item.path) || /\bConquera\b/.test(item.name) },
  { id: 'moframe', a: 'limited', k: 'moframe', test: (item) => inFolder(item, /\/Mustache\/$/) || /\b(Movember|Moframe)\b/.test(item.name) },
  { id: 'anniversary', a: 'limited', k: 'anniversary', test: (item) => /Anniversary|Dex/.test(file(item.path)) || /\b(Anniversary|Dex)\b/.test(item.name) },
  // Baro vor den Festen: Er verkauft auch Day-of-the-Dead-Skins (Ordner `VoidTrader`).
  { id: 'baro', a: 'limited', k: 'baro', test: (item) => inFolder(item, /\/(VoidTrader|Armor\/BaroArmour\w*)\/$/) || file(item.path).startsWith('Baro') || BARO_NAMES.test(item.name) },
  { id: 'seasonal', a: 'limited', k: 'seasonal', test: (item) => inBundle(item, SEASONAL_BUNDLES) || inFolder(item, SEASONAL_FOLDERS) || SEASONAL_NAMES.test(item.name) },
  { id: 'dogDays', a: 'limited', k: 'event', test: (item) => /\bDog Days\b/.test(item.name) },
  // Nicht mehr erhältlich
  { id: 'convention', a: 'gone', k: 'convention', test: (item) => /\b(GCX|GuardianCon|TennoVIP)\b/.test(item.name) || /GamingCommunityExpo|GuardianCon|TennoVIP/.test(file(item.path)) },
  { id: 'partner', a: 'gone', k: 'partner', test: (item) => inFolder(item, /\/(Promo\/PCGamer|Promo\/RixtyMOL|IAHGames|Nvidia|ReferralSeriesTwo)\/$/) || /\b(Rubedo Plated|Phased|Amethyst)\b|^Warframe x /.test(item.name) },
  { id: 'twitch', a: 'gone', k: 'twitch', test: (item) => inFolder(item, /\/Promo\/Twitch\/$/) },
  { id: 'promo', a: 'gone', k: 'promo', test: (item) => /^Image(\d{4}Twitter|YouTube)/.test(file(item.path)) },
  { id: 'retired', a: 'gone', k: 'retired', test: (item) => /\bretired\b/i.test(item.description) || /^(GolemRaidBadgeItem|SevantiHaloBadgeItem|SevantiLegacyHaloBadgeItem|NightmareSevantiHaloBadgeItem)$/.test(file(item.path)) },
  {
    id: 'pastEvent',
    a: 'gone',
    k: (item) => (/\boperation\b/i.test(item.description) ? 'operation' : 'event'),
    test: (item) => (DURING.test(item.description) && /\b(event|operation|Dilemma|Incursions)\b/i.test(item.description)) || AWARDED_TO.test(item.description) || inFolder(item, /\/ScarletSpear\/$/),
  },
];

/**
 * Zustand und Art eines Teils nach der ersten passenden Regel; `undefined`, wenn keine passt.
 * @param {Cosmetic} item @returns {(Availability & { rule: string }) | undefined}
 */
export function classify(item) {
  const rule = RULES.find((candidate) => candidate.test(item));
  if (!rule) return undefined;
  return { a: rule.a, k: typeof rule.k === 'function' ? rule.k(item) : rule.k, rule: rule.id };
}

/**
 * @typedef {{ a: State | 'unknown', k?: Kind, n: string, src: string, checked: string }} Exception
 *   Eintrag von Hand: Pfad oder Ordner (`/` am Ende). `a: 'unknown'` hebt eine falsche Regel auf.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isState = (/** @type {unknown} */ value) => /** @type {readonly unknown[]} */ (STATES).includes(value);
const isKind = (/** @type {unknown} */ value) => /** @type {readonly unknown[]} */ (KINDS).includes(value);
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Prüft die Ausnahmen streng: Ein Fehler hält den Lauf an, damit nie eine Ausnahme stillschweigend wegfällt.
 * @param {unknown} json @returns {Record<string, Exception>}
 */
export function readExceptions(json) {
  if (!isRecord(json) || !isRecord(json['items'])) throw new Error('exceptions.json: expected { "items": { … } }');
  /** @type {Record<string, Exception>} */
  const result = {};
  for (const [key, value] of Object.entries(json['items'])) {
    const where = `exceptions.json, ${key}`;
    if (!key.startsWith('/Lotus/')) throw new Error(`${where}: key must be a game path or folder`);
    if (!isRecord(value)) throw new Error(`${where}: entry must be an object`);
    const { a, k, n, src, checked } = value;
    if (a !== 'unknown' && !isState(a)) throw new Error(`${where}: unknown state ${String(a)}`);
    if (a !== 'unknown' && !isKind(k)) throw new Error(`${where}: unknown kind ${String(k)}`);
    if (typeof n !== 'string' || n.trim() === '') throw new Error(`${where}: note n missing`);
    if (typeof src !== 'string' || !src.startsWith('https://')) throw new Error(`${where}: src must be a link`);
    if (typeof checked !== 'string' || !DAY.test(checked)) throw new Error(`${where}: checked must be a day (YYYY-MM-DD)`);
    result[key] = /** @type {Exception} */ ({ a, ...(a === 'unknown' ? {} : { k }), n, src, checked });
  }
  return result;
}

/**
 * Ausnahme für einen Pfad: der Pfad selbst, sonst der längste passende Ordner.
 * @param {string} path @param {Record<string, Exception>} exceptions @returns {Exception | undefined}
 */
export function exceptionFor(path, exceptions) {
  if (Object.hasOwn(exceptions, path)) return exceptions[path];
  let best;
  for (const key of Object.keys(exceptions)) if (key.endsWith('/') && path.startsWith(key) && (!best || key.length > best.length)) best = key;
  return best === undefined ? undefined : exceptions[best];
}
