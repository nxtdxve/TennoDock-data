// @ts-check
// Wikitext lesen, ohne Abhängigkeiten (#164): Vorlagen mit Argumenten, Tabellen mit Abschnitt und Kopfzeile, Klartext für
// die Anzeige in TennoDock. Reine Funktionen; die Seiten kommen aus der MediaWiki-API des WARFRAME Wiki.

/**
 * @typedef {{ positional: string[], named: Record<string, string> }} Template
 * @typedef {{ heading: string, header: string[], rows: string[][] }} Table `heading`: letzte Überschrift vor der Tabelle.
 */

/** Häufige Vorlagen mit Wert und Einheit (Platin, Standing, Credits, Ducats). */
const AMOUNTS = /** @type {Readonly<Record<string, string>>} */ ({ pc: 'Platinum', sc: 'Standing', cc: 'Credits', dc: 'Ducats' });

/**
 * Teilt den Inhalt einer Vorlage (ohne `{{` und `}}`) an den `|` der obersten Ebene; `|` in `[[…]]` und `{{…}}` zählen nicht.
 * @param {string} inner @returns {string[]}
 */
export function splitArgs(inner) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const two = inner.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      depth++;
      i++;
    } else if ((two === '}}' || two === ']]') && depth > 0) {
      depth--;
      i++;
    } else if (inner[i] === '|' && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts;
}

/**
 * Alle Vorlagen `{{name|…}}` (Name ohne Gross- und Kleinschreibung am Anfang), auch über mehrere Zeilen und mit
 * verschachtelten Vorlagen. Argumente `a = b` sind benannt (ohne Leerraum), die übrigen positionell.
 * @param {string} text @param {string} name @returns {Template[]}
 */
export function templates(text, name) {
  /** @type {Template[]} */
  const found = [];
  const open = new RegExp(`\\{\\{\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?=[|}\\n])`, 'gi');
  for (const match of text.matchAll(open)) {
    let depth = 0;
    let end = -1;
    for (let i = match.index; i < text.length - 1; i++) {
      const two = text.slice(i, i + 2);
      if (two === '{{') {
        depth++;
        i++;
      } else if (two === '}}') {
        depth--;
        i++;
        if (depth === 0) {
          end = i - 1;
          break;
        }
      }
    }
    if (end < 0) continue;
    const [, ...args] = splitArgs(text.slice(match.index + 2, end));
    /** @type {Template} */
    const template = { positional: [], named: {} };
    for (const arg of args) {
      const named = /^\s*([\w ]+?)\s*=([\s\S]*)$/.exec(arg);
      if (named?.[1] !== undefined && named[2] !== undefined && !arg.trimStart().startsWith('[[')) template.named[named[1].toLowerCase()] = named[2].trim();
      else template.positional.push(arg.trim());
    }
    found.push(template);
  }
  return found;
}

/** Eine Vorlage als Klartext: Mengen mit Einheit, sonst ihr letztes Argument (`{{Faction|Red Veil}}` → Red Veil). @param {string} inner */
function templateText(inner) {
  const [name = '', ...args] = splitArgs(inner).map((part) => part.trim());
  const unit = AMOUNTS[name.toLowerCase()];
  if (unit && args[0]) return `${args[0]} ${unit}`;
  const values = args.filter((arg) => !/^\w+\s*=/.test(arg));
  return values.at(-1) ?? '';
}

/**
 * Klartext für die Anzeige: ohne Dateien, Fussnoten, HTML und Hervorhebungen; Links und Vorlagen werden zu ihrem Text,
 * Leerraum zusammengezogen.
 * @param {string} text @returns {string}
 */
export function plain(text) {
  let out = text
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, '');
  // Innen nach aussen: zuerst Vorlagen und Links ohne weitere darin.
  for (let pass = 0; pass < 5; pass++) {
    const before = out;
    out = out.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => templateText(inner));
    out = out.replace(/\[\[([^[\]]*)\]\]/g, (_, inner) => {
      const parts = String(inner).split('|');
      return (parts.length > 1 ? parts.at(-1) : (parts[0] ?? '').replace(/#.*$/, '')) ?? '';
    });
    if (out === before) break;
  }
  return out
    .replace(/'{2,}/g, '')
    .replace(/\[(?:https?:)?\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?)])/g, '$1')
    .trim();
}

/** Ziele der Links in einem Stück Wikitext (`[[Ziel|Text]]` → Ziel), ohne Dateien. @param {string} text @returns {string[]} */
export function linkTargets(text) {
  return [...text.matchAll(/\[\[([^[\]|#]+)(?:#[^[\]|]*)?(?:\|[^[\]]*)?\]\]/g)].map((match) => (match[1] ?? '').trim()).filter((target) => !/^(?:File|Image|Category):/i.test(target));
}

/**
 * Tabellen `{| … |}` mit der letzten Überschrift davor, der Kopfzeile (`!`) und den Zeilen (`|-`). Zellen einer Zeile
 * stehen in eigenen Zeilen (`| a`) oder hintereinander (`| a || b`); Attribute vor einem einzelnen `|` fallen weg.
 * @param {string} text @returns {Table[]}
 */
export function tables(text) {
  /** @type {Table[]} */
  const found = [];
  let heading = '';
  /** @type {Table | undefined} */
  let table;
  /** @type {string[] | undefined} */
  let row;
  const cell = (/** @type {string} */ raw) => {
    const parts = splitArgs(raw);
    return (parts.length > 1 && /=/.test(parts[0] ?? '') && !/\[\[|\{\{/.test(parts[0] ?? '') ? parts.slice(1).join('|') : raw).trim();
  };
  for (const line of text.split(/\r?\n/)) {
    const title = /^(={2,6})\s*(.*?)\s*\1\s*$/.exec(line);
    if (title && !table) {
      heading = plain(title[2] ?? '');
      continue;
    }
    if (line.startsWith('{|')) {
      table = { heading, header: [], rows: [] };
      row = undefined;
      continue;
    }
    if (!table) continue;
    if (line.startsWith('|}')) {
      if (row && row.length > 0) table.rows.push(row);
      found.push(table);
      table = undefined;
      row = undefined;
      continue;
    }
    if (line.startsWith('|-')) {
      if (row && row.length > 0) table.rows.push(row);
      row = [];
      continue;
    }
    if (line.startsWith('!')) {
      for (const part of line.slice(1).split('!!')) table.header.push(plain(cell(part)));
      continue;
    }
    if (line.startsWith('|+')) continue;
    if (line.startsWith('|')) {
      row ??= [];
      for (const part of line.slice(1).split('||')) row.push(cell(part));
    } else if (row && row.length > 0) {
      // Fortsetzung einer Zelle über mehrere Zeilen.
      row[row.length - 1] += `\n${line}`;
    }
  }
  return found;
}

/**
 * Ein Abschnitt (`== Überschrift ==`) bis zur nächsten Überschrift derselben oder höheren Ebene; `undefined`, wenn er fehlt.
 * @param {string} text @param {string} heading @returns {string | undefined}
 */
export function section(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const match = /^(={2,6})\s*(.*?)\s*\1\s*$/.exec(line);
    return match !== null && plain(match[2] ?? '').toLowerCase() === heading.toLowerCase();
  });
  if (start < 0) return undefined;
  const level = /^=+/.exec(lines[start] ?? '')?.[0].length ?? 2;
  const end = lines.findIndex((line, index) => index > start && new RegExp(`^={2,${level}}[^=]`).test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}
