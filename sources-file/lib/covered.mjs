// @ts-check
// Was TennoDock ohne Wiki schon zuordnet (#164 Nacharbeit), damit `missing.json` nur echte Lücken zählt. Dieselben Regeln
// wie im App-Kern, aus denselben Dateien von public-export-plus:
//   - Markt: `excludeFromMarket` fehlt und ein Preis (plus-sources `collectMarket`), oder im Paket mit Platin (`collectBundleMarket`),
//   - Händler und Syndikate: `ExportVendors` (`items[].storeItem`) und `ExportSyndicates` (`favours[].storeItem`),
//   - Kosmetik: Standard-Teil (`alwaysAvailable`), „Kommt mit“ (`additionalItems`), am PC nicht erhältlich
//     (`excludedPlatforms` mit `CP_WINDOWS` oder Pfad wie `notOnPcByPath`), Regeln nach Name und Pfad (`cosmeticRule`),
//     Supporter Pack, ersetzt (`REPLACED_COSMETICS`).
//   - Seit #273: Kosmetik in Paketen, die Händler und Syndikate verkaufen, Markt-Pakete ohne Preis (`packageDiscount` oder
//     `creditsCost`, ohne Deluxe), Kosmetik aus allen Nightwave-Staffeln (`ExportSyndicates[RadioLegion…].titles`),
//     Challenges (`ExportChallenges`), Anhänge von Nachrichten (`ExportEmailItems`), TennoGen ohne Preis, Gründer-Embleme,
//     `…Statless`-Zwillinge.
// Fällt eine Regel in der App weg oder kommt eine dazu, gehört sie auch hierher. Reine Funktionen.

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** @param {unknown} value @returns {Record<string, unknown>[]} */
const records = (value) => (Array.isArray(value) ? value.filter(isRecord) : []);
/** Pfad wie im DE-Export (`/StoreItems/` fällt weg). @param {string} path */
const itemPath = (path) => path.replace('/StoreItems/', '/');
/** Schlüssel eines Pakets in `ExportBundles` (nur der Anfang `/Lotus/StoreItems/` fällt weg, wie `normalizeItemPath`). @param {string} path */
const bundlePath = (path) => (path.startsWith('/Lotus/StoreItems/') ? `/Lotus/${path.slice('/Lotus/StoreItems/'.length)}` : path);
/** Wurzeln der Kosmetik wie `COSMETIC_ROOTS` in der App. */
const COSMETIC_ROOTS = ['/Lotus/Upgrades/Skins/', '/Lotus/Characters/Tenno/Accessory/', '/Lotus/Types/StoreItems/AvatarImages/', '/Lotus/Types/Items/Emotes/', '/Lotus/Types/StoreItems/SuitCustomizations/', '/Lotus/Types/Items/Titles/'];
/** @param {string} path */
const isCosmetic = (path) => COSMETIC_ROOTS.some((root) => path.startsWith(root));
const DELUXE = /Deluxe/i;
const positive = (/** @type {unknown} */ value) => typeof value === 'number' && value > 0;

const EPHEMERA = '/Lotus/Upgrades/Skins/Effects/';
/** Wie `CLAN_SIGILS` und `REPLACED_COSMETICS` in der App. */
const CLAN_SIGILS = new Set(['/Lotus/Upgrades/Skins/Sigils/ClanSigilBasic', '/Lotus/Upgrades/Skins/Sigils/AllianceSigilBasic']);
const REPLACED = new Set(['/Lotus/Upgrades/Skins/Sigils/MasterySigil']);

/**
 * Am PC nicht erhältlich nach Pfad (wie `notOnPcByPath` in der App): China-Client und Treue-Siegel der Konsolen. `WeGame…`
 * nicht: Die Lunar-Renewal-Sigils gibt es am PC zum Mondneujahr im Markt oder bei Baro (Wiki „Sigils“, Review M1).
 * @param {string} path
 */
export function notOnPcByPath(path) {
  const file = path.slice(path.lastIndexOf('/') + 1);
  return path.includes('/ChangYou/') || /^CY[A-Z]/.test(file) || /^(PS4|XBone)\w*YearSigil$|^Switch\d*Sigil$/.test(file);
}

/**
 * Regel nach Name und Pfad für Kosmetik (wie `cosmeticRule` in der App, ohne Standard-Teile und Honorias).
 * @param {string} path @param {string | undefined} name englischer Name @returns {string | undefined}
 */
export function cosmeticRule(path, name) {
  if (path.startsWith(`${EPHEMERA}Kuva/`)) return 'kuvaLich';
  if (path.startsWith(`${EPHEMERA}CorpusLichEphemera`)) return 'sisters';
  if (path.startsWith(`${EPHEMERA}InfestedLichEphemera`)) return 'coda';
  if (CLAN_SIGILS.has(path)) return 'clan';
  if (path.startsWith('/Lotus/Upgrades/Skins/Clan/FoundersBadge')) return 'founders';
  const file = path.slice(path.lastIndexOf('/') + 1);
  if (/tennocon/i.test(file) || name?.startsWith('TennoCon ')) return 'tennocon';
  if (/twitch/i.test(file)) return 'twitch';
  if (name !== undefined && /\bPrime\b/.test(name) && !/^VT[A-Z]/.test(file)) return 'primeAccess';
  return undefined;
}

/**
 * @typedef {{ customs?: unknown, resources?: unknown, bundles?: unknown, vendors?: unknown, syndicates?: unknown, challenges?: unknown, emails?: unknown, names: ReadonlyMap<string, string> }} RuleData
 */

/**
 * Pfad → Art des Fundorts, den die App ohne Wiki kennt (die erste passende Regel).
 * @param {RuleData} data @returns {Map<string, string>}
 */
export function gameSources(data) {
  /** @type {Map<string, string>} */
  const found = new Map();
  const add = (/** @type {string} */ path, /** @type {string} */ kind) => void (found.has(path) || found.set(path, kind));
  // Markt und Pakete
  for (const file of [data.customs, data.resources]) {
    for (const [path, value] of Object.entries(isRecord(file) ? file : {})) {
      if (isRecord(value) && value['excludeFromMarket'] !== true && (positive(value['platinumCost']) || positive(value['creditsCost']))) add(path, 'market');
    }
  }
  /** @type {Set<string>} */
  const supporterPack = new Set();
  /** Kosmetik pro Paket (#273), für Pakete bei Händlern und Syndikaten. @type {Map<string, string[]>} */
  const packCosmetics = new Map();
  for (const [bundle, value] of Object.entries(isRecord(data.bundles) ? data.bundles : {})) {
    if (!isRecord(value)) continue;
    const listed = value['excludeFromMarket'] !== true;
    const market = listed && positive(value['platinumCost']);
    // #273: im Markt ohne eigenen Preis (Rabatt aus den Teilen oder Credit-Preis), ohne alte Deluxe-Pakete.
    const unpriced = listed && !market && (typeof value['packageDiscount'] === 'number' || positive(value['creditsCost'])) && !DELUXE.test(bundle);
    const supporter = /SupporterPack/i.test(bundle.slice(bundle.lastIndexOf('/') + 1));
    const cosmetics = [];
    for (const component of records(value['components'])) {
      const item = typeof component['typeName'] === 'string' ? itemPath(component['typeName']) : undefined;
      if (item && market) add(item, 'market');
      if (item && unpriced) add(item, 'bundle');
      if (item && supporter) supporterPack.add(item);
      if (item && isCosmetic(item)) cosmetics.push(item);
    }
    if (cosmetics.length > 0) packCosmetics.set(bundle, cosmetics);
  }
  // Händler und Syndikate, seit #273 mit der Kosmetik in verkauften Paketen
  const offered = (/** @type {string} */ storeItem, /** @type {string} */ kind) => {
    add(itemPath(storeItem), kind);
    for (const item of packCosmetics.get(bundlePath(storeItem)) ?? []) add(item, kind);
  };
  for (const value of Object.values(isRecord(data.vendors) ? data.vendors : {})) {
    for (const offer of records(isRecord(value) ? value['items'] : undefined)) if (typeof offer['storeItem'] === 'string') offered(offer['storeItem'], 'vendor');
  }
  for (const [tag, value] of Object.entries(isRecord(data.syndicates) ? data.syndicates : {})) {
    for (const favour of records(isRecord(value) ? value['favours'] : undefined)) if (typeof favour['storeItem'] === 'string') offered(favour['storeItem'], 'syndicate');
    // #273: Ränge aller Nightwave-Staffeln
    if (!tag.startsWith('RadioLegion')) continue;
    for (const title of records(isRecord(value) ? value['titles'] : undefined)) {
      const reward = isRecord(title['reward']) ? title['reward'] : {};
      const item = typeof reward['StoreItem'] === 'string' ? reward['StoreItem'] : reward['ItemType'];
      if (typeof item === 'string' && isCosmetic(bundlePath(item))) add(itemPath(item), 'nightwave');
    }
  }
  // #273: Challenges (gezählte Belohnungen und Anhänge) und Anhänge von Nachrichten; wie in der App nur Kosmetik (Review K3)
  for (const value of Object.values(isRecord(data.challenges) ? data.challenges : {})) {
    if (!isRecord(value)) continue;
    const message = isRecord(value['message']) ? value['message'] : {};
    const rewards = [...records(value['countedRewards']).map((reward) => reward['StoreItem']), ...(Array.isArray(message['attachments']) ? message['attachments'] : [])];
    for (const item of rewards) if (typeof item === 'string' && isCosmetic(bundlePath(item))) add(itemPath(item), 'challenge');
  }
  for (const value of Object.values(isRecord(data.emails) ? data.emails : {})) {
    const message = isRecord(value) && isRecord(value['message']) ? value['message'] : {};
    for (const item of Array.isArray(message['attachments']) ? message['attachments'] : []) if (typeof item === 'string' && isCosmetic(bundlePath(item))) add(itemPath(item), 'inbox');
  }
  // Kosmetik aus `ExportCustoms`
  for (const [path, value] of Object.entries(isRecord(data.customs) ? data.customs : {})) {
    if (!isRecord(value)) continue;
    if (value['alwaysAvailable'] === true) add(path, 'default');
    if (Array.isArray(value['excludedPlatforms']) && value['excludedPlatforms'].includes('CP_WINDOWS')) add(path, 'notOnPc');
    for (const extra of Array.isArray(value['additionalItems']) ? value['additionalItems'] : []) if (typeof extra === 'string' && extra !== path) add(itemPath(extra), 'comesWith');
  }
  for (const path of supporterPack) add(path, 'supporterPack');
  for (const path of REPLACED) add(path, 'replaced');
  // #273: alte Fassungen mit `…Statless`-Zwilling (Arcane-Helme)
  const customs = new Set(Object.keys(isRecord(data.customs) ? data.customs : {}));
  for (const path of customs) if (path.endsWith('Statless') && customs.has(path.slice(0, -'Statless'.length))) add(path.slice(0, -'Statless'.length), 'replaced');
  return found;
}

/**
 * TennoGen nach dem Pfad wie `isTennoGen` in der App (#164, seit #273 auch ohne Preis): Datei `SW…` oder Ordner
 * `SteamWorkshop`, keine Glyphen.
 * @param {string} path
 */
export function isTennoGenPath(path) {
  if (path.startsWith('/Lotus/Types/StoreItems/AvatarImages/')) return false;
  return /^SW[A-Z0-9]/.test(path.slice(path.lastIndexOf('/') + 1)) || path.includes('/SteamWorkshop/');
}

/**
 * Fundort der App für einen Pfad, auch nach Name und Pfad allein (Regeln, am PC nicht erhältlich).
 * @param {string} path @param {ReadonlyMap<string, string>} known aus `gameSources` @param {string | undefined} name
 * @returns {string | undefined}
 */
export function appSource(path, known, name) {
  return known.get(path) ?? cosmeticRule(path, name) ?? (notOnPcByPath(path) ? 'notOnPc' : isTennoGenPath(path) ? 'tennogen' : undefined);
}
