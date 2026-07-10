import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPPA_API } from './mappa-api';

// `__dirname` non esiste sotto vitest (ESM). Stesso pattern di mappa-enforcement.test.ts.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'); // apps/piattaforma
const API_DIR = resolve(ROOT, 'src/app/api');

/** Barre sempre `/`: `path.relative` su Windows ritorna `\`. */
function toPosix(p: string): string {
  return p.split('\\').join('/');
}

/** Tutte le `route.ts` sotto `src/app/api`, percorso relativo a `ROOT` (`src/app/api/...`). */
function tutteLeRouteApi(): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === 'route.ts') {
        out.push(full);
      }
    }
  }
  walk(API_DIR);
  return out.map((abs) => toPosix(relative(ROOT, abs)));
}

describe('mappa-api', () => {
  it('ogni file mappato esiste', () => {
    for (const rel of Object.keys(MAPPA_API)) {
      expect(existsSync(resolve(ROOT, rel)), `manca ${rel}`).toBe(true);
    }
  });

  it('ogni route.ts sotto src/app/api è classificata nella mappa', () => {
    const mancanti: string[] = [];
    for (const rel of tutteLeRouteApi()) {
      if (!(rel in MAPPA_API)) mancanti.push(rel);
    }
    expect(
      mancanti,
      `Route API senza classificazione. Aggiungila a mappa-api.ts col permesso che la protegge ` +
        `(hasPermesso/requirePermesso in cima all'handler), oppure con null e la ragione nel commento (staff ` +
        `piattaforma, cron, pre-sessione, infrastruttura, ecc.). Se non sei sicuro che debba restare senza gate, ` +
        `mappala comunque a null con la nota "da valutare" e segnalala:\n  ${mancanti.join('\n  ')}`,
    ).toEqual([]);
  });

  it("ogni route mappata con un permesso lo cita davvero (hasPermesso/requirePermesso('<permesso>')) nel proprio sorgente", () => {
    const senzaGate: string[] = [];
    for (const [rel, permesso] of Object.entries(MAPPA_API)) {
      if (permesso === null) continue;
      const path = resolve(ROOT, rel);
      if (!existsSync(path)) {
        senzaGate.push(`${rel} → ${permesso} (file non trovato)`);
        continue;
      }
      const src = readFileSync(path, 'utf8');
      if (!src.includes(`hasPermesso('${permesso}')`) && !src.includes(`requirePermesso('${permesso}')`)) {
        senzaGate.push(`${rel} → ${permesso}`);
      }
    }
    expect(
      senzaGate,
      `Permesso dichiarato in mappa-api.ts ma la route non chiama hasPermesso('<permesso>') né ` +
        `requirePermesso('<permesso>') nel proprio sorgente. Una voce nella mappa non è un gate: senza questa ` +
        `chiamata la route risponde comunque a chiunque abbia solo una sessione. Aggiungi il controllo, o correggi ` +
        `la mappa se il permesso dichiarato non è quello giusto:\n  ${senzaGate.join('\n  ')}`,
    ).toEqual([]);
  });
});
