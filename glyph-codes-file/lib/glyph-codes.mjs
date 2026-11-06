// @ts-check
// Codes der Creator-Glyphen (#122) aus dem Quelltext der Wiki-Seite „Glyph“: Abschnitt „Creator Glyphs“ mit der Vorlage
// `{{GlyphBoxPromo|Bild|Name|Code|Info}}` (fehlt der Code, ist der Name der Code). Reine Funktionen ohne Abhängigkeiten.
// Einziger Parser: Ihn nutzen die Action des Daten-Repos (`build.mjs`) und im App-Repo das Skript für die mitgelieferte
// Liste (`scripts/glyph-codes-from-wiki.mjs`). Die App selbst liest nur die fertige Datei.

/**
 * @typedef {{ code: string, image: string, name?: string }} GlyphCode Code, Bilddatei im Wiki und der Name, falls er
 *   vom Code abweicht.
 */

const TEMPLATE = '{{GlyphBoxPromo';
/** Was ein Code sein kann: Buchstaben, Ziffern und wenige Zeichen (`r/warframe`, `1999-VOICEPLAY`), ohne Leerzeichen. */
export const CODE = /^[A-Za-z0-9][A-Za-z0-9_\-./!]{0,63}$/;
export const IMAGE = /^[^|[\]{}<>]+\.(png|jpe?g|gif|webp)$/i;

/**
 * Abschnitt ab der Überschrift `heading` (jede Ebene, `==Name==` bis `======Name======`) bis vor die nächste Überschrift
 * derselben oder einer höheren Ebene; Unterabschnitte gehören dazu. `undefined` ohne diese Überschrift. Geschnitten wird
 * am Namen, nicht an der Nummer: Die Nummer verschiebt sich, sobald jemand weiter oben eine Überschrift einfügt.
 * @param {string} source @param {string} heading @returns {string | undefined}
 */
export function wikiSection(source, heading) {
  const lines = source.split('\n');
  const headingOf = (/** @type {string} */ line) => /^(={1,6})\s*(.*?)\s*\1\s*$/.exec(line);
  const start = lines.findIndex((line) => headingOf(line)?.[2] === heading);
  if (start < 0) return undefined;
  const level = headingOf(lines[start] ?? '')?.[1]?.length ?? 2;
  const end = lines.findIndex((line, index) => index > start && (headingOf(line)?.[1]?.length ?? 99) <= level);
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

/**
 * Parameter einer Vorlage ab `{{`: auf oberster Ebene nach `|` getrennt; verschachtelte `{{…}}` und `[[…]]` bleiben
 * ganz. `undefined`, wenn die Vorlage nicht schliesst.
 * @param {string} text @param {number} start @returns {{ params: string[], end: number } | undefined}
 */
function templateParams(text, start) {
  let depth = 0;
  let current = '';
  /** @type {string[]} */
  const parts = [];
  for (let at = start; at < text.length; at++) {
    const pair = text.slice(at, at + 2);
    if (pair === '{{' || pair === '[[') {
      depth++;
      if (depth > 1) current += pair;
      at++;
    } else if (pair === '}}' || pair === ']]') {
      depth--;
      if (depth === 0) return { params: [...parts, current].slice(1), end: at + 2 };
      current += pair;
      at++;
    } else if (text[at] === '|' && depth === 1) {
      parts.push(current);
      current = '';
    } else {
      current += text[at];
    }
  }
  return undefined;
}

/**
 * Positionen 1 bis 3; `2=…` überschreibt wie in MediaWiki die Stelle.
 * @param {readonly string[]} params @returns {string[]}
 */
function positional(params) {
  /** @type {string[]} */
  const values = [];
  let next = 0;
  for (const param of params) {
    const named = /^\s*(\d)\s*=([\s\S]*)$/.exec(param);
    if (named) values[Number(named[1]) - 1] = named[2] ?? '';
    else values[next++] = param;
  }
  return Array.from(values, (value) => (value ?? '').trim());
}

/**
 * Einträge eines Abschnitts in der Reihenfolge des Wikis; unlesbare Einträge fallen weg, gleiche Codes zählen einmal.
 * @param {string} section @returns {GlyphCode[]}
 */
export function parseGlyphCodes(section) {
  const text = section.replace(/<!--[\s\S]*?-->/g, '');
  /** @type {GlyphCode[]} */
  const entries = [];
  const seen = new Set();
  for (let at = text.indexOf(TEMPLATE); at >= 0; at = text.indexOf(TEMPLATE, at + TEMPLATE.length)) {
    // Nur genau diese Vorlage, nicht `{{GlyphBoxPromoX…`.
    if (!/[\s|}]/.test(text[at + TEMPLATE.length] ?? '')) continue;
    const parsed = templateParams(text, at);
    if (!parsed) continue;
    const [file = '', second = '', third = ''] = positional(parsed.params);
    const image = file.replace(/^(File|Image):/i, '');
    const code = third || second;
    const name = third ? second : '';
    if (!CODE.test(code) || !IMAGE.test(image) || seen.has(code.toLowerCase())) continue;
    seen.add(code.toLowerCase());
    entries.push({ code, image, ...(name && name !== code ? { name } : {}) });
  }
  return entries;
}
