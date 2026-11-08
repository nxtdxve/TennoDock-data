// @ts-check
// Prüft `palettes/v1/palettes.json` (#206) vor dem Commit: `node palettes-file/check.mjs`. Gibt die Fehler aus und endet
// mit Code 1, wenn es welche gibt. Kein Netz.
import { readFileSync } from 'node:fs';
import { checkPalettes } from './lib/palettes.mjs';

const FILE = new URL('../palettes/v1/palettes.json', import.meta.url);
let errors;
try {
  errors = checkPalettes(JSON.parse(readFileSync(FILE, 'utf8')));
} catch (error) {
  errors = [`cannot read the file: ${error instanceof Error ? error.message : String(error)}`];
}
for (const error of errors) console.error(error);
console.log(errors.length === 0 ? 'palettes.json is fine' : `${errors.length} problem(s)`);
process.exitCode = errors.length === 0 ? 0 : 1;
