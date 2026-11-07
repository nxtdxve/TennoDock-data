// @ts-check
// Was TennoDock ohne Wiki schon zuordnet (#164 Nacharbeit), damit `missing.json` nur echte Lücken zählt. Dieselben Regeln
// wie im App-Kern, aus denselben Dateien von public-export-plus:
//   - Markt: `excludeFromMarket` fehlt und ein Preis (plus-sources `collectMarket`), oder im Paket mit Platin (`collectBundleMarket`),
//   - Händler und Syndikate: `ExportVendors` (`items[].storeItem`) und `ExportSyndicates` (`favours[].storeItem`),
//   - Kosmetik: Standard-Teil (`alwaysAvailable`), „Kommt mit“ (`additionalItems`), am PC nicht erhältlich
//     (`excludedPlatforms` mit `CP_WINDOWS` oder Pfad wie `notOnPcByPath`), Regeln nach Name und Pfad (`cosmeticRule`),
//     Supporter Pack, ersetzt (`REPLACED_COSMETICS`).
// Fällt eine Regel in der App weg oder kommt eine dazu, gehört sie auch hierher. Reine Funktionen.

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** @param {unknown} value @returns {Record<string, unknown>[]} */
const records = (value) => (Array.isArray(value) ? value.filter(isRecord) : []);
/** Pfad wie im DE-Export (`/StoreItems/` fällt weg). @param {string} path */
const itemPath = (path) => path.replace('/StoreItems/', '/');
const positive = (/** @type {unknown} */ value) => typeof value === 'number' && value > 0;

const EPHEMERA = '/Lotus/Upgrades/Skins/Effects/';
/** Wie `CLAN_SIGILS` und `REPLACED_COSMETICS` in der App. */
const CLAN_SIGILS = new Set(['/Lotus/Upgrades/Skins/Sigils/ClanSigilBasic', '/Lotus/Upgrades/Skins/Sigils/AllianceSigilBasic']);
const REPLACED = new Set(['/Lotus/Upgrades/Skins/Sigils/MasterySigil']);

/**
 * Am PC nicht erhältlich nach Pfad (wie `notOnPcByPath` in der App): China-Client und Treue-Siegel der Konsolen.
 * @param {string} path
 */
export function notOnPcByPath(path) {
  const file = path.slice(path.lastIndexOf('/') + 1);
  return path.includes('/ChangYou/') || /^CY[A-Z]/.test(file) || file.startsWith('WeGame') || /^(PS4|XBone)\w*YearSigil$|^Switch\d*Sigil$/.test(file);
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
  const file = path.slice(path.lastIndexOf('/') + 1);
  if (/tennocon/i.test(file) || name?.startsWith('TennoCon ')) return 'tennocon';
  if (/twitch/i.test(file)) return 'twitch';
  if (name !== undefined && /\bPrime\b/.test(name) && !/^VT[A-Z]/.test(file)) return 'primeAccess';
  return undefined;
}

/**
 * @typedef {{ customs?: unknown, resources?: unknown, bundles?: unknown, vendors?: unknown, syndicates?: unknown, names: ReadonlyMap<string, string> }} RuleData
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
  for (const [bundle, value] of Object.entries(isRecord(data.bundles) ? data.bundles : {})) {
    if (!isRecord(value)) continue;
    const market = value['excludeFromMarket'] !== true && positive(value['platinumCost']);
    const supporter = /SupporterPack/i.test(bundle.slice(bundle.lastIndexOf('/') + 1));
    for (const component of records(value['components'])) {
      const item = typeof component['typeName'] === 'string' ? itemPath(component['typeName']) : undefined;
      if (item && market) add(item, 'market');
      if (item && supporter) supporterPack.add(item);
    }
  }
  // Händler und Syndikate
  for (const value of Object.values(isRecord(data.vendors) ? data.vendors : {})) {
    for (const offer of records(isRecord(value) ? value['items'] : undefined)) if (typeof offer['storeItem'] === 'string') add(itemPath(offer['storeItem']), 'vendor');
  }
  for (const value of Object.values(isRecord(data.syndicates) ? data.syndicates : {})) {
    for (const favour of records(isRecord(value) ? value['favours'] : undefined)) if (typeof favour['storeItem'] === 'string') add(itemPath(favour['storeItem']), 'syndicate');
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
  return found;
}

/**
 * Fundort der App für einen Pfad, auch nach Name und Pfad allein (Regeln, am PC nicht erhältlich).
 * @param {string} path @param {ReadonlyMap<string, string>} known aus `gameSources` @param {string | undefined} name
 * @returns {string | undefined}
 */
export function appSource(path, known, name) {
  return known.get(path) ?? cosmeticRule(path, name) ?? (notOnPcByPath(path) ? 'notOnPc' : undefined);
}
