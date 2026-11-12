// @ts-nocheck
// ERZEUGT aus src/core/masterdata/public-export-parts.ts im TennoDock-Repo (#179), nicht von Hand ändern.
// Neu erzeugen im TennoDock-Repo: UPDATE_DERIVE=1 npx vitest run src/core/masterdata/public-export-derive.test.ts
// (rolldown, Format esm, Plattform neutral). Der Test vergleicht die Datei Byte für Byte mit dem Code der App.
//#region src/core/json.ts
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asRecord(value) {
	return isRecord(value) ? value : void 0;
}
function asArray(value) {
	return Array.isArray(value) ? value : void 0;
}
function asRecords(value) {
	return asArray(value)?.filter(isRecord);
}
function asNumber(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function asString(value) {
	return typeof value === "string" ? value : void 0;
}
//#endregion
//#region src/core/masterdata/paths.ts
/**
* `/Lotus/StoreItems/…` → `/Lotus/…`, `…/VoltBaseSuit` → `…/Volt` (Helminth-Angebot).
*/
function normalizeItemPath(path) {
	let result = path.startsWith("/Lotus/StoreItems/") ? `/Lotus/${path.slice(18)}` : path;
	if (result.endsWith("BaseSuit")) result = result.slice(0, -8);
	return result;
}
//#endregion
//#region src/core/masterdata/relics.ts
const REFINEMENTS = [
	"intact",
	"exceptional",
	"flawless",
	"radiant"
];
/** Jede Veredelung ist ein eigener Pfad mit dieser Endung (bestätigt über `quality` in public-export-plus). */
const SUFFIXES = {
	intact: "Bronze",
	exceptional: "Silver",
	flawless: "Gold",
	radiant: "Platinum"
};
const SUFFIX_PATTERN = /(Bronze|Silver|Gold|Platinum)$/;
const RARITIES$1 = {
	COMMON: "common",
	UNCOMMON: "uncommon",
	RARE: "rare"
};
/** Veredelung eines Relic-Pfads anhand der Endung, z. B. `…Platinum` → Strahlend. */
function refinementOf(path) {
	const suffix = SUFFIX_PATTERN.exec(normalizeItemPath(path))?.[1];
	return REFINEMENTS.find((refinement) => SUFFIXES[refinement] === suffix);
}
/** Pfad ohne Endung der Veredelung: derselbe Schlüssel für alle Formen eines Relics. */
function relicKey(path) {
	return normalizeItemPath(path).replace(SUFFIX_PATTERN, "");
}
function cleanName$2(name) {
	return (name ?? "").replace(/<[^>]*>\s*/g, "").trim();
}
/** Relics aus `ExportRelicArcane` (englisch). Einträge ohne `relicRewards` sind Arcanes und fallen weg. */
function collectRelics(json) {
	const relics = {};
	for (const entry of asRecords(asRecord(json)?.["ExportRelicArcane"]) ?? []) {
		const path = asString(entry["uniqueName"]);
		const rewards = asArray(entry["relicRewards"]);
		if (!path || !rewards) continue;
		const key = relicKey(path);
		const refinement = refinementOf(path);
		const known = relics[key];
		if (known) {
			if (refinement && known.refinements && !known.refinements.includes(refinement)) known.refinements.push(refinement);
			continue;
		}
		const relic = { rewards: [] };
		const era = cleanName$2(asString(entry["name"])).split(" ")[0];
		if (era) relic.era = era;
		if (refinement) relic.refinements = [refinement];
		for (const reward of rewards) {
			if (!isRecord(reward)) continue;
			const item = asString(reward["rewardName"]);
			if (!item) continue;
			const parsed = {
				item: normalizeItemPath(item),
				count: asNumber(reward["itemCount"]) ?? 1
			};
			const rarity = RARITIES$1[asString(reward["rarity"]) ?? ""];
			if (rarity) parsed.rarity = rarity;
			relic.rewards.push(parsed);
		}
		relics[key] = relic;
	}
	for (const relic of Object.values(relics)) relic.refinements?.sort((a, b) => REFINEMENTS.indexOf(a) - REFINEMENTS.indexOf(b));
	return relics;
}
//#endregion
//#region src/core/masterdata/mods.ts
/** Polaritäten mit den Codes von DE; dieselben stehen im Inventar (`Polarity[].Value`, `pol` der Rivens). */
const POLARITIES = [
	"AP_ATTACK",
	"AP_DEFENSE",
	"AP_TACTIC",
	"AP_POWER",
	"AP_WARD",
	"AP_PRECEPT",
	"AP_UMBRA",
	"AP_UNIVERSAL",
	"AP_ANY"
];
const RARITIES = /* @__PURE__ */ new Map([
	["COMMON", "common"],
	["UNCOMMON", "uncommon"],
	["RARE", "rare"],
	["LEGENDARY", "legendary"]
]);
const POLARITY_SET = new Set(POLARITIES);
const RIVEN_FOLDER = "/Lotus/Upgrades/Mods/Randomized/";
const ANTIQUE_FOLDER = "/Lotus/Upgrades/Mods/Antiques/";
/** Höchstrang der Rivens: DE nennt 0, im Spiel 0 bis 8 (Wiki Riven Mods, plus `fusionLimit` 8). */
const RIVEN_MAX_RANK = 8;
const PECULIAR = "Peculiar ";
const cleanName$1 = (name) => (name ?? "").replace(/<[^>]*>\s*/g, "").trim();
/** Sonderform am Pfad; `undefined` bei einem normalen Mod. */
function modVariant(path) {
	const normalized = normalizeItemPath(path);
	const segments = normalized.split("/");
	const file = segments[segments.length - 1] ?? "";
	if (normalized.startsWith(RIVEN_FOLDER)) return file.startsWith("Raw") ? "veiledRiven" : "riven";
	if (normalized.startsWith(ANTIQUE_FOLDER)) return "antique";
	if (segments.includes("Beginner")) return "flawed";
	if (segments.includes("PvPMods") || file.includes("PvP")) return "conclave";
}
/** Ordner mit internen Fassungen normaler Mods (anderer Höchstrang, andere Werte); dort liegen auch Primed und Galvanized. */
const INTERNAL_FOLDERS = ["Expert", "Intermediate"];
const isInternalFolder = (path) => path.split("/").some((segment) => INTERNAL_FOLDERS.includes(segment));
/**
* Doppel-Einträge zusammenführen: Normale Mods (ohne Sonderform, nicht aus dem Codex genommen) mit gleichem englischem
* Namen und gleicher Kategorie bilden eine Gruppe. Vertreter ist der erste Pfad im Export, der nicht in `Expert` oder
* `Intermediate` liegt, sonst der erste überhaupt; die anderen bekommen `sameAs`. Geprüft am Export vom 18.10.2026:
* 94 Gruppen, 111 Pfade mit `sameAs`; besessene und angebotene Pfade (Händler, Syndikate) sind immer der Vertreter.
*/
function markDuplicates(mods, names) {
	const groups = /* @__PURE__ */ new Map();
	for (const [path, mod] of Object.entries(mods)) {
		const name = names.get(path);
		if (name === void 0 || mod.variant !== void 0 || mod.codex === false) continue;
		const key = `${mod.category ?? ""}\u0000${name}`;
		groups.set(key, [...groups.get(key) ?? [], path]);
	}
	for (const paths of groups.values()) {
		if (paths.length < 2) continue;
		const representative = paths.find((path) => !isInternalFolder(path)) ?? paths[0];
		for (const path of paths) {
			const mod = mods[path];
			if (mod && path !== representative && representative !== void 0) mod.sameAs = representative;
		}
	}
}
/**
* Mods und Sets aus `ExportUpgrades` (englisch). Einträge ohne Namen (Platzhalter) fallen weg. Peculiar-Mods sind
* ungewöhnlich (Wiki Fusion, Endo), auch wo DE sie als gewöhnlich führt; erkannt am englischen Namen.
* Doppel-Einträge zeigen mit `sameAs` auf ihren Vertreter (`markDuplicates`).
*/
function collectMods(json) {
	const record = asRecord(json);
	const mods = {};
	const names = /* @__PURE__ */ new Map();
	for (const entry of asRecords(record?.["ExportUpgrades"]) ?? []) {
		const path = asString(entry["uniqueName"]);
		const name = cleanName$1(asString(entry["name"]));
		if (!path || !name) continue;
		const mod = {};
		const polarity = asString(entry["polarity"]);
		if (polarity && POLARITY_SET.has(polarity)) mod.polarity = polarity;
		const rarity = name.startsWith(PECULIAR) ? "uncommon" : RARITIES.get(asString(entry["rarity"]) ?? "");
		if (rarity) mod.rarity = rarity;
		const variant = modVariant(path);
		const fusionLimit = asNumber(entry["fusionLimit"]);
		if (variant === "riven") mod.maxRank = RIVEN_MAX_RANK;
		else if (variant === "veiledRiven") mod.maxRank = 0;
		else if (fusionLimit !== void 0 && fusionLimit >= 0) mod.maxRank = fusionLimit;
		const drain = asNumber(entry["baseDrain"]);
		if (drain !== void 0) mod.drain = drain;
		const category = asString(entry["type"]);
		if (category) mod.category = category;
		const subtype = asString(entry["subtype"]);
		if (subtype) mod.augmentOf = normalizeItemPath(subtype);
		if (entry["isUtility"] === true) mod.exilus = true;
		const set = asString(entry["modSet"]);
		if (set) mod.set = set;
		if (variant) mod.variant = variant;
		if (entry["excludeFromCodex"] === true) mod.codex = false;
		mods[path] = mod;
		names.set(path, name);
	}
	markDuplicates(mods, names);
	const modSets = {};
	for (const entry of asRecords(record?.["ExportModSet"]) ?? []) {
		const path = asString(entry["uniqueName"]);
		const size = asNumber(entry["numUpgradesInSet"]);
		if (path && size !== void 0) modSets[path] = size;
	}
	return {
		mods,
		modSets
	};
}
/**
* Augments zeigen auf `…BaseSuit`, ohne die Endung meist genau auf den Warframe. Heisst der Warframe anders
* (Nova: `…/AntiMatter/Anti`), gilt der einzige normale Warframe im selben Ordner. `frames`: Pfade ohne Prime.
* Gibt eine neue Tabelle zurück; die Eingabe bleibt unverändert.
*/
function linkAugments(mods, frames) {
	const known = new Set(frames);
	const byFolder = /* @__PURE__ */ new Map();
	for (const frame of frames) {
		const folder = frame.slice(0, frame.lastIndexOf("/"));
		byFolder.set(folder, [...byFolder.get(folder) ?? [], frame]);
	}
	const linked = {};
	for (const [path, mod] of Object.entries(mods)) {
		const target = mod.augmentOf;
		const candidates = target && !known.has(target) ? byFolder.get(target.slice(0, target.lastIndexOf("/"))) : void 0;
		linked[path] = candidates?.length === 1 && candidates[0] ? {
			...mod,
			augmentOf: candidates[0]
		} : mod;
	}
	return linked;
}
/**
* Arcanes aus `ExportRelicArcane` (englisch): die Einträge ohne `relicRewards`. Fehlt die Seltenheit, ist sie
* gewöhnlich: DE lässt `COMMON` hier weg (21 von 21 laut plus, kein Arcane trägt `COMMON`). Den Höchstrang gibt es
* nur als Anzahl der Stufen in `levelStats`. Einträge ohne Stufen fallen weg: Es sind interne Hilfseinträge
* (4 × „Arcane Steadfast“, `…Ability<n>Listener`), die sonst doppelt in jeder Liste stünden.
*/
function collectArcanes(json) {
	const arcanes = {};
	for (const entry of asRecords(asRecord(json)?.["ExportRelicArcane"]) ?? []) {
		const path = asString(entry["uniqueName"]);
		const levels = asArray(entry["levelStats"])?.length;
		if (!path || entry["relicRewards"] !== void 0 || levels === void 0 || levels === 0) continue;
		const rarityCode = asString(entry["rarity"]);
		const rarity = rarityCode === void 0 ? "common" : RARITIES.get(rarityCode);
		const arcane = { maxRank: levels - 1 };
		if (rarity) arcane.rarity = rarity;
		if (entry["excludeFromCodex"] === true) arcane.codex = false;
		arcanes[path] = arcane;
	}
	return arcanes;
}
//#endregion
//#region src/core/masterdata/rivens.ts
const PLACEHOLDER = /\|[A-Za-z0-9]+\|(%|s(?=\s))?/;
/** Fraktionsschaden zeigt das Spiel als Faktor (×1,25), DE schreibt ihn ohne Einheit (Wiki: „×(1 + v)“). */
const FACTION_TAG = /FactionDamage/;
function readStat(entry) {
	const first = asRecords(entry["upgradeValues"])?.[0];
	const base = asNumber(first?.["value"]);
	if (base === void 0) return void 0;
	const text = (asString(first?.["locTag"]) ?? "").replace(/<[^>]*>/g, "");
	const unitMark = PLACEHOLDER.exec(text)?.[1];
	const tag = asString(entry["tag"]) ?? "";
	const stat = {
		base,
		unit: FACTION_TAG.test(tag) ? "multiplier" : unitMark === "%" ? "percent" : unitMark === "s" ? "seconds" : "number"
	};
	const name = text.replace(PLACEHOLDER, "").replace(/\s+/g, " ").trim();
	if (name) stat.name = name;
	if (first?.["reverseValueSymbol"] === true) stat.reversed = true;
	const prefix = asString(entry["prefixTag"]);
	if (prefix) stat.prefix = prefix;
	const suffix = asString(entry["suffixTag"]);
	if (suffix) stat.suffix = suffix;
	return stat;
}
/**
* Enthüllte Riven-Typen aus `ExportUpgrades` (englisch): Einträge mit `upgradeEntries` im Riven-Ordner. Railjack-Waffen
* und Kuva-Lich-Einträge haben auch `upgradeEntries`, sind aber keine Rivens; verhüllte Typen (`Raw…`) haben keine.
* Eine Eigenschaft ohne Tag oder Zahl fällt weg; zählt nur der erste Wert (der zweite ist z. B. „x2 for Bows“).
*/
function collectRivenTypes(json) {
	const types = {};
	for (const entry of asRecords(asRecord(json)?.["ExportUpgrades"]) ?? []) {
		const path = asString(entry["uniqueName"]);
		const list = asRecords(entry["upgradeEntries"]);
		if (!path || !list || modVariant(path) !== "riven") continue;
		const stats = {};
		for (const item of list) {
			const tag = asString(item["tag"]);
			const stat = tag ? readStat(item) : void 0;
			if (tag && stat) stats[tag] = stat;
		}
		if (Object.keys(stats).length > 0) types[path] = stats;
	}
	return types;
}
//#endregion
//#region src/core/masterdata/catalog.ts
const PRIME = /\bPrime\b/;
function cleanName(name) {
	return (name ?? "").replace(/<[^>]*>\s*/g, "").trim();
}
/** Einträge einer Exportdatei, z. B. `ExportWeapons` in ExportWeapons_en.json. */
function entries(json, key) {
	return asRecords(asRecord(json)?.[key]) ?? [];
}
function baseItem(file, entry) {
	const item = { file };
	const category = asString(entry["productCategory"]);
	if (category) item.category = category;
	const masteryReq = asNumber(entry["masteryReq"]);
	if (masteryReq !== void 0) item.masteryReq = masteryReq;
	const maxLevelCap = asNumber(entry["maxLevelCap"]);
	if (maxLevelCap !== void 0) item.maxLevelCap = maxLevelCap;
	if (PRIME.test(cleanName(asString(entry["name"])))) item.prime = true;
	const ducats = asNumber(entry["primeSellingPrice"]);
	if (ducats !== void 0) item.ducats = ducats;
	return item;
}
function parseRecipe(entry) {
	const id = asString(entry["uniqueName"]);
	const result = asString(entry["resultType"]);
	if (!id || !result) return void 0;
	const ingredients = [];
	for (const ingredient of asRecords(entry["ingredients"]) ?? []) {
		const item = asString(ingredient["ItemType"]);
		const count = asNumber(ingredient["ItemCount"]);
		if (item && count !== void 0) ingredients.push({
			item,
			count
		});
	}
	return {
		id,
		result,
		resultCount: asNumber(entry["num"]) ?? 1,
		buildTime: asNumber(entry["buildTime"]) ?? 0,
		buildPrice: asNumber(entry["buildPrice"]) ?? 0,
		skipPrice: asNumber(entry["skipBuildTimePrice"]) ?? 0,
		consumeOnUse: entry["consumeOnUse"] !== false,
		ingredients
	};
}
/** Items einer Datei; `extra` ergänzt oder verwirft einen Eintrag (`false`). */
function collectItems(file, list, extra) {
	const items = {};
	for (const entry of list) {
		const path = asString(entry["uniqueName"]);
		if (!path) continue;
		const item = baseItem(file, entry);
		if (extra && !extra(entry, item)) continue;
		items[path] = item;
	}
	return items;
}
/** Teil des Katalogs aus der englischen Datei `key` (#179). Zusammengesetzt mit `combineDeCatalog`. */
function collectDeCatalogPart(key, json) {
	switch (key) {
		case "warframes": return { items: collectItems("Warframes", entries(json, "ExportWarframes")) };
		case "weapons": return { items: collectItems("Weapons", entries(json, "ExportWeapons"), (entry, item) => {
			if (!("slot" in entry)) item.noSlot = true;
			const disposition = asNumber(entry["omegaAttenuation"]);
			if (disposition !== void 0) item.disposition = disposition;
			const asPrimary = asNumber(entry["primeOmegaAttenuation"]);
			if (asPrimary !== void 0) item.dispositionAsPrimary = asPrimary;
			return true;
		}) };
		case "sentinels": return { items: collectItems("Sentinels", entries(json, "ExportSentinels")) };
		case "resources": return { items: collectItems("Resources", entries(json, "ExportResources"), (_entry, item) => item.ducats !== void 0) };
		case "recipes": {
			const recipes = [];
			const items = [];
			for (const entry of entries(json, "ExportRecipes")) {
				const recipe = parseRecipe(entry);
				if (!recipe) continue;
				recipes.push(recipe);
				items.push(baseItem("Recipes", entry));
			}
			return {
				recipes,
				items
			};
		}
		case "relics": return {
			relics: collectRelics(json),
			arcanes: collectArcanes(json)
		};
		case "upgrades": {
			const { mods, modSets } = collectMods(json);
			return {
				mods,
				modSets,
				rivens: collectRivenTypes(json)
			};
		}
		case "fusionBundles": {
			const endo = {};
			for (const entry of entries(json, "ExportFusionBundles")) {
				const path = asString(entry["uniqueName"]);
				const points = asNumber(entry["fusionPoints"]);
				if (path && points !== void 0 && points > 0) endo[path] = points;
			}
			return { endo };
		}
	}
}
const partRecord = (part, key) => asRecord(part?.[key]) ?? {};
/** Katalog aus seinen Teilen (#179); fehlt ein Teil, fehlen seine Einträge wie in `collectDeCatalog`. */
function combineDeCatalog(parts) {
	const items = {};
	for (const key of [
		"warframes",
		"weapons",
		"sentinels",
		"resources"
	]) Object.assign(items, partRecord(parts[key], "items"));
	const recipes = [];
	const recipeItems = asArray(parts.recipes?.["items"]) ?? [];
	for (const [i, recipe] of (asArray(parts.recipes?.["recipes"]) ?? []).entries()) {
		const item = { ...recipeItems[i] };
		if (items[recipe.result]?.prime) item.prime = true;
		recipes.push(recipe);
		items[recipe.id] = item;
	}
	const catalog = {
		items,
		recipes
	};
	if (parts.relics !== void 0) {
		catalog.relics = partRecord(parts.relics, "relics");
		catalog.arcanes = partRecord(parts.relics, "arcanes");
	}
	if (parts.upgrades !== void 0) {
		const frames = Object.entries(items).filter(([, item]) => item.file === "Warframes" && item.category === "Suits" && !item.prime).map(([path]) => path);
		catalog.mods = linkAugments(partRecord(parts.upgrades, "mods"), frames);
		catalog.modSets = partRecord(parts.upgrades, "modSets");
		catalog.rivens = partRecord(parts.upgrades, "rivens");
	}
	if (parts.fusionBundles !== void 0) catalog.endo = partRecord(parts.fusionBundles, "endo");
	return catalog;
}
//#endregion
//#region src/core/masterdata/cosmetics.ts
/** Pfade aller Einträge aus DE `ExportCustoms` (Skins, Helme, Anhänge, Syandanas, Signa, Ephemeras, Sigils …). */
function collectCosmeticPaths(json) {
	const paths = /* @__PURE__ */ new Set();
	for (const entry of asArray(asRecord(json)?.["ExportCustoms"]) ?? []) {
		const path = asRecord(entry)?.["uniqueName"];
		if (typeof path === "string" && path.startsWith("/Lotus/")) paths.add(path);
	}
	return { paths: [...paths].sort() };
}
//#endregion
//#region src/core/masterdata/mod-stats.ts
/** Dateien mit `levelStats`; beide stehen ohnehin in den Namensdateien, kosten also keinen eigenen Abruf. */
const MOD_STATS_FILES = ["ExportUpgrades", "ExportRelicArcane"];
const NUMBER = /\d+(?:[.,]\d+)?/g;
/** Steuerzeichen, die in DE-Texten nicht vorkommen: Platzhalter, Trenner der Ränge, Ende des Gerüsts, Texte pro Rang. */
const SLOT = "";
const RANKS = "";
const VALUES = "";
const PER_RANK = "";
/** Tags der 13 Schadensarten im DE-Export → Art. */
const DAMAGE_TAGS = {
	DT_IMPACT_COLOR: "impact",
	DT_PUNCTURE_COLOR: "puncture",
	DT_SLASH_COLOR: "slash",
	DT_FIRE_COLOR: "heat",
	DT_FREEZE_COLOR: "cold",
	DT_ELECTRICITY_COLOR: "electricity",
	DT_POISON_COLOR: "toxin",
	DT_EXPLOSION_COLOR: "blast",
	DT_CORROSIVE_COLOR: "corrosive",
	DT_GAS_COLOR: "gas",
	DT_MAGNETIC_COLOR: "magnetic",
	DT_RADIATION_COLOR: "radiation",
	DT_VIRAL_COLOR: "viral"
};
/** Text eines Rangs: Schadensarten als Marke (`EFFECT_ICON`), alle anderen Tags wie `<LOWER_IS_BETTER>` weg, Zeilen getrimmt. */
function clean(text) {
	return text.replace(/<([^>]*)>/g, (_tag, name) => {
		const type = DAMAGE_TAGS[name];
		return type ? "" + type + "" : "";
	}).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join("\n");
}
/** `levelStats` (pro Rang `{ stats: string[] }`) → kompakter Text; ohne Texte `undefined`. */
function encodeLevelStats(levelStats) {
	const texts = asArray(levelStats)?.map((rank) => (asArray(asRecord(rank)?.["stats"]) ?? []).filter((line) => typeof line === "string").map(clean).filter(Boolean).join("\n"));
	if (!texts || texts.every((text) => text === "")) return void 0;
	const skeletons = texts.map((text) => text.replace(NUMBER, SLOT));
	if (skeletons.some((skeleton) => skeleton !== skeletons[0])) return PER_RANK + texts.join(RANKS);
	return skeletons[0] + VALUES + texts.map((text) => (text.match(NUMBER) ?? []).join("|")).join(RANKS);
}
new RegExp(`([a-z]+)`, "g");
/**
* Set-Bonus eines Sets (#126, `ExportModSet` in `ExportUpgrades`): `stats` nennt einen Text pro Anzahl ausgerüsteter Teile
* (1, 2, … `numUpgradesInSet`). Gespeichert wie die Ränge eines Mods; die Stufe für k Teile liefert `statsAt(…, k − 1)`.
*/
function setBonusLevels(entry) {
	if (entry["levelStats"] !== void 0 || typeof entry["numUpgradesInSet"] !== "number") return void 0;
	return asArray(entry["stats"])?.map((text) => ({ stats: [text] }));
}
/**
* Text eines Mods ohne `levelStats` (#126): die Beschreibung, gleich für jeden Rang. So zeigen z. B. die Requiem-Mods ihre
* Verse und die Peculiar-Mods ihren Effekt (im Export nur `description`). Nur Mods unter `/Lotus/Upgrades/Mods/` und die
* Peculiar-Mods, damit die Tabelle klein bleibt.
*/
const DESCRIPTION_PATHS = ["/Lotus/Upgrades/Mods/", "/Lotus/Upgrades/CosmeticEnhancers/Peculiars/"];
function descriptionLevels(entry, path) {
	if (entry["levelStats"] !== void 0 || !DESCRIPTION_PATHS.some((prefix) => path.startsWith(prefix))) return void 0;
	const description = entry["description"];
	const lines = typeof description === "string" ? [description] : asArray(description);
	return lines && lines.length > 0 ? [{ stats: lines }] : void 0;
}
/**
* Alle Effekt-Texte einer Exportdatei in `into`, Pfad → kompakter Text: Listen mit `uniqueName` und `levelStats` (Mods,
* Arcanes), seit #126 die Set-Boni aus `ExportModSet` (Pfad des Sets, z. B. `…/Sets/Augur/AugurSetMod`) und bei Mods ohne
* `levelStats` die Beschreibung.
*/
function collectModStats(json, into = {}) {
	for (const list of Object.values(asRecord(json) ?? {})) for (const entry of asRecords(list) ?? []) {
		const path = asString(entry["uniqueName"]);
		const stats = path ? encodeLevelStats(entry["levelStats"] ?? setBonusLevels(entry) ?? descriptionLevels(entry, path)) : void 0;
		if (path && stats) into[path] = stats;
	}
	return into;
}
//#endregion
//#region src/core/masterdata/star-chart.ts
/** Name und Planet aus `ExportRegions_<Sprache>` des DE-Exports. */
function collectRegionNames(json) {
	const names = {};
	for (const entry of asRecords(asRecord(json)?.["ExportRegions"]) ?? []) {
		const tag = asString(entry["uniqueName"]);
		if (!tag) continue;
		const name = asString(entry["name"]);
		const planet = asString(entry["systemName"]);
		names[tag] = {
			...name ? { name } : {},
			...planet ? { planet } : {}
		};
	}
	return names;
}
//#endregion
//#region src/core/masterdata/public-export-parts.ts
/** Dateien mit Namen (Items, Warframes, Mods, Nightwave, Bundles …), in dieser Reihenfolge zusammengesetzt. */
const NAME_FILES = [
	"ExportResources",
	"ExportWarframes",
	"ExportSortieRewards",
	"ExportGear",
	"ExportUpgrades",
	"ExportRecipes",
	"ExportRelicArcane",
	"ExportFusionBundles",
	"ExportCustoms",
	"ExportKeys",
	"ExportWeapons",
	"ExportSentinels",
	"ExportFlavour"
];
/** Teil der Signatur der Namens-Tabellen: Ändert sich, was gesammelt wird, entstehen sie neu. */
const NAMES_FORMAT = "names-3";
const IMAGE_FILE = "ExportManifest.json";
/** Enthält `ExportNightwave.challenges[]` mit `required`; sprachunabhängig, gelesen mit der ersten Sprache. */
const NIGHTWAVE_FILE = "ExportSortieRewards";
/** Katalog aus den englischen Dateien (Strukturdaten). Alle stehen auch in NAME_FILES, kosten also keinen eigenen Download. */
const CATALOG_LANGUAGE = "en";
const CATALOG_FILES = {
	warframes: "ExportWarframes",
	weapons: "ExportWeapons",
	sentinels: "ExportSentinels",
	resources: "ExportResources",
	recipes: "ExportRecipes",
	relics: "ExportRelicArcane",
	upgrades: "ExportUpgrades",
	fusionBundles: "ExportFusionBundles"
};
/** Teil der Signatur: Ändert sich die Ableitung, entsteht die Tabelle neu, auch bei gleichem DE-Stand. */
const CATALOG_FORMAT = "catalog-5";
/** Farben der Paletten (#75): dieselbe englische Datei wie für die Namen. */
const PALETTE_FILE = "ExportFlavour";
/** Effekt-Texte der Mods pro Sprache (#114), eigene Tabelle neben den Namen; seit #126 mit den Set-Boni (Format 3). */
const MOD_STATS_FORMAT = "modstats-3";
const PALETTES_FORMAT = "palettes-1";
/** Gesamtliste der Kosmetik (#98): dieselbe englische Datei wie für die Namen. */
const COSMETICS_FILE = "ExportCustoms";
const COSMETICS_FORMAT = "cosmetics-1";
/** Name und Planet der Knoten der Sternenkarte (#36), übersetzt pro Sprache. */
const REGIONS_FILE = "ExportRegions";
const REGIONS_FORMAT = "regions-1";
/** Formate der Teile ohne eigenes Tabellenformat (Bildpfade, Nightwave); die Signatur ihrer Tabelle ist die Index-Zeile. */
const IMAGES_FORMAT = "images-1";
const NIGHTWAVE_FORMAT = "nightwave-1";
/** Zahl im Format der Sprache; ein Sprachcode, den `Intl` nicht kennt, fällt auf Englisch zurück. */
function formatCount(value, language) {
	try {
		return new Intl.NumberFormat(language).format(value);
	} catch {
		return new Intl.NumberFormat("en").format(value);
	}
}
/** Namen aus einer Datei; Endo-Pakete heissen „30,000 Endo“, die Zahl im Format von `language`. */
function collectNamesPart(json, language = "en") {
	const part = {
		names: {},
		endo: {}
	};
	const walk = (value) => {
		if (Array.isArray(value)) for (const item of value) walk(item);
		else if (isRecord(value)) {
			for (const [uniqueKey, nameKey] of [["uniqueName", "name"], ["abilityUniqueName", "abilityName"]]) {
				const unique = value[uniqueKey];
				const name = value[nameKey];
				if (typeof unique === "string" && typeof name === "string") {
					const clean = name.replace(/<[^>]*>\s*/g, "").trim();
					if (clean) part.names[unique] = clean;
				}
			}
			const unique = value["uniqueName"];
			const points = value["fusionPoints"];
			if (typeof unique === "string" && part.endo[unique] === void 0 && typeof points === "number" && points > 0) part.endo[unique] = `${formatCount(points, language)} Endo`;
			for (const child of Object.values(value)) if (typeof child === "object" && child !== null) walk(child);
		}
	};
	walk(json);
	return part;
}
/** Namen der Teile in ihrer Reihenfolge: Ein späterer echter Name gewinnt; Endo nur, wo kein Teil einen Namen hat. */
function mergeNameParts(parts, into = {}) {
	for (const part of parts) Object.assign(into, part.names);
	for (const part of parts) for (const [path, name] of Object.entries(part.endo)) if (into[path] === void 0) into[path] = name;
	return into;
}
/**
* Alle Objekte mit `uniqueName` und `name` einsammeln, egal wie tief verschachtelt. Markup wie `<SHARD_BLUE_SIMPLE>` fällt weg.
* Endo-Pakete (`ExportFusionBundles`) haben keinen Namen, nur `fusionPoints`: Sie heissen „30,000 Endo“, die Zahl im Format von `language`.
*/
function collectNames(json, into = {}, language = "en") {
	return mergeNameParts([collectNamesPart(json, language)], into);
}
function collectImages(json) {
	const images = {};
	const list = asRecord(json)?.["Manifest"];
	if (Array.isArray(list)) {
		for (const entry of list) if (isRecord(entry) && typeof entry["uniqueName"] === "string" && typeof entry["textureLocation"] === "string") images[entry["uniqueName"]] = entry["textureLocation"];
	}
	return images;
}
/** Zielwerte der Nightwave-Challenges (`ExportNightwave.challenges[].required`), Schlüssel = Challenge-Pfad. */
function collectNightwaveTargets(json) {
	const targets = {};
	const challenges = asRecord(asRecord(json)?.["ExportNightwave"])?.["challenges"];
	if (Array.isArray(challenges)) {
		for (const challenge of challenges) if (isRecord(challenge) && typeof challenge["uniqueName"] === "string" && typeof challenge["required"] === "number") targets[challenge["uniqueName"]] = challenge["required"];
	}
	return targets;
}
/**
* Farben der Paletten (#75) aus `ExportFlavour[].hexColours` (`{ value: "0x00RRGGBB" }`), Schlüssel = Pfad der Palette.
* Ein unlesbares Feld wird `null`, damit die übrigen ihre Position behalten. Einträge ohne Farben fallen weg.
*/
function collectPalettes(json) {
	const palettes = {};
	const list = asRecord(json)?.["ExportFlavour"];
	if (!Array.isArray(list)) return palettes;
	for (const entry of list) {
		if (!isRecord(entry) || typeof entry["uniqueName"] !== "string" || !Array.isArray(entry["hexColours"])) continue;
		palettes[entry["uniqueName"]] = entry["hexColours"].map((colour) => {
			const value = asRecord(colour)?.["value"];
			return (typeof value === "string" ? /^0x[0-9a-f]{2}([0-9a-f]{6})$/i.exec(value) : null)?.[1]?.toUpperCase() ?? null;
		});
	}
	return palettes;
}
/** Signatur eines Teils im Cache und im Daten-Repo. */
const partSignature = (part) => `${part.format}|${part.entry}`;
const partCache = (key) => `pe-part-${key.replace(/\//g, "-")}.json`;
/**
* Tabellen, die die Indexe verlangen. `indexes`: Datei → Index-Zeile pro Sprache; fehlt der Index einer Sprache, fehlen ihre
* Tabellen. Katalog, Paletten und Kosmetik aus Englisch, Bildpfade und Nightwave aus der ersten Sprache.
*/
function planTables(languages, indexes) {
	const tables = [];
	for (const [position, language] of languages.entries()) {
		const index = indexes.get(language);
		if (!index) continue;
		const line = (file) => index.get(`${file}_${language}.json`);
		const nameEntries = NAME_FILES.flatMap((file) => {
			const entry = line(file);
			return entry ? [{
				file,
				entry
			}] : [];
		});
		tables.push({
			key: `names:${language}`,
			kind: "names",
			cacheName: `pe-names-${language}.json`,
			signature: [NAMES_FORMAT, ...nameEntries.map(({ entry }) => entry)].join("|"),
			parts: nameEntries.map(({ file, entry }) => ({
				key: `names/${language}/${file}`,
				entry,
				format: `${NAMES_FORMAT}/part-1`,
				cacheName: partCache(`names/${language}/${file}`),
				derive: (json) => collectNamesPart(json, language)
			}))
		});
		const statsEntries = MOD_STATS_FILES.flatMap((file) => {
			const entry = line(file);
			return entry ? [{
				file,
				entry
			}] : [];
		});
		tables.push({
			key: `modstats:${language}`,
			kind: "modstats",
			cacheName: `pe-modstats-${language}.json`,
			signature: [MOD_STATS_FORMAT, ...statsEntries.map(({ entry }) => entry)].join("|"),
			parts: statsEntries.map(({ file, entry }) => ({
				key: `modstats/${language}/${file}`,
				entry,
				format: `${MOD_STATS_FORMAT}/part-1`,
				cacheName: partCache(`modstats/${language}/${file}`),
				derive: (json) => collectModStats(json)
			}))
		});
		const regions = line(REGIONS_FILE);
		if (regions) tables.push({
			key: `regions:${language}`,
			kind: "regions",
			cacheName: `pe-regions-${language}.json`,
			signature: `${REGIONS_FORMAT}|${regions}`,
			parts: [{
				key: `regions/${language}`,
				entry: regions,
				format: REGIONS_FORMAT,
				derive: (json) => collectRegionNames(json)
			}]
		});
		if (language === "en") {
			const catalogEntries = Object.entries(CATALOG_FILES).map(([key, file]) => ({
				key,
				entry: line(file)
			}));
			tables.push({
				key: "catalog",
				kind: "catalog",
				cacheName: "pe-catalog.json",
				signature: [CATALOG_FORMAT, ...catalogEntries.filter(({ key }) => key !== "fusionBundles").map(({ entry }) => entry ?? "-")].join("|"),
				parts: catalogEntries.flatMap(({ key, entry }) => entry ? [{
					key: `catalog/${key}`,
					entry,
					format: `${CATALOG_FORMAT}/part-1`,
					cacheName: partCache(`catalog/${key}`),
					derive: (json) => collectDeCatalogPart(key, json)
				}] : [])
			});
			const palettes = line(PALETTE_FILE);
			if (palettes) tables.push({
				key: "palettes",
				kind: "palettes",
				cacheName: "pe-palettes.json",
				signature: `${PALETTES_FORMAT}|${palettes}`,
				parts: [{
					key: "palettes",
					entry: palettes,
					format: PALETTES_FORMAT,
					derive: collectPalettes
				}]
			});
			const cosmetics = line(COSMETICS_FILE);
			if (cosmetics) tables.push({
				key: "cosmetics",
				kind: "cosmetics",
				cacheName: "pe-cosmetics.json",
				signature: `${COSMETICS_FORMAT}|${cosmetics}`,
				parts: [{
					key: "cosmetics",
					entry: cosmetics,
					format: COSMETICS_FORMAT,
					derive: (json) => collectCosmeticPaths(json)
				}]
			});
		}
		if (position === 0) {
			const images = index.get(IMAGE_FILE);
			if (images) tables.push({
				key: "images",
				kind: "images",
				cacheName: "pe-images.json",
				signature: images,
				parts: [{
					key: "images",
					entry: images,
					format: IMAGES_FORMAT,
					derive: collectImages
				}]
			});
			const nightwave = line(NIGHTWAVE_FILE);
			if (nightwave) tables.push({
				key: "nightwave",
				kind: "nightwave",
				cacheName: "pe-nightwave.json",
				signature: nightwave,
				parts: [{
					key: "nightwave",
					entry: nightwave,
					format: NIGHTWAVE_FORMAT,
					derive: collectNightwaveTargets
				}]
			});
		}
	}
	return tables;
}
/** Ob gespeicherte Daten zum Teil passen können (grob; die Daten stammen von der App oder dem eigenen Daten-Repo). */
function isPartData(part, data) {
	if (!isRecord(data)) return false;
	if (part.key.startsWith("names/")) return isRecord(data["names"]) && isRecord(data["endo"]);
	return true;
}
/** Tabelle aus ihren Teilen, in der Reihenfolge von `table.parts`. */
function combineTable(table, parts) {
	switch (table.kind) {
		case "names": return mergeNameParts(parts);
		case "modstats": return Object.assign({}, ...parts);
		case "catalog": {
			const byKey = {};
			for (const [i, plan] of table.parts.entries()) {
				const data = parts[i];
				if (data) byKey[plan.key.slice(8)] = data;
			}
			return combineDeCatalog(byKey);
		}
		default: return parts[0] ?? {};
	}
}
//#endregion
export { CATALOG_FILES, CATALOG_FORMAT, CATALOG_LANGUAGE, COSMETICS_FILE, COSMETICS_FORMAT, IMAGES_FORMAT, IMAGE_FILE, MOD_STATS_FORMAT, NAMES_FORMAT, NAME_FILES, NIGHTWAVE_FILE, NIGHTWAVE_FORMAT, PALETTES_FORMAT, PALETTE_FILE, REGIONS_FILE, REGIONS_FORMAT, collectImages, collectNames, collectNamesPart, collectNightwaveTargets, collectPalettes, combineTable, isPartData, mergeNameParts, partSignature, planTables };
