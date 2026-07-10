import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPPA_ENFORCEMENT } from './mappa-enforcement';

// `__dirname` non esiste sotto vitest (ESM). Stesso pattern di
// src/lib/notifiche/pratica-schema.test.ts e degli altri test che leggono file.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'); // apps/piattaforma

/** Nomi delle server action esportate: `export async function nome(`. */
function actionEsportate(rel: string): string[] {
  const src = readFileSync(resolve(ROOT, rel), 'utf8');
  return [...src.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]);
}

describe('mappa-enforcement', () => {
  it('ogni file mappato esiste', () => {
    for (const rel of Object.keys(MAPPA_ENFORCEMENT)) {
      expect(existsSync(resolve(ROOT, rel)), `manca ${rel}`).toBe(true);
    }
  });

  it('ogni server action esportata è classificata nella mappa', () => {
    const mancanti: string[] = [];
    for (const [rel, actions] of Object.entries(MAPPA_ENFORCEMENT)) {
      for (const nome of actionEsportate(rel)) {
        if (!(nome in actions)) mancanti.push(`${rel}:${nome}`);
      }
    }
    expect(
      mancanti,
      `Server action senza classificazione. Aggiungile a mappa-enforcement.ts col permesso ` +
        `che le protegge, oppure con null e la ragione:\n  ${mancanti.join('\n  ')}`,
    ).toEqual([]);
  });

  it('ogni action classificata con un permesso lo cita davvero nel sorgente', () => {
    const senzaGate: string[] = [];
    for (const [rel, actions] of Object.entries(MAPPA_ENFORCEMENT)) {
      const src = readFileSync(resolve(ROOT, rel), 'utf8');
      for (const [nome, permesso] of Object.entries(actions)) {
        if (permesso === null) continue;
        if (!src.includes(`'${permesso}'`)) senzaGate.push(`${rel}:${nome} → ${permesso}`);
      }
    }
    expect(
      senzaGate,
      `Permesso dichiarato in mappa-enforcement.ts ma mai citato come stringa nel file. ` +
        `Verifica che il gate esista davvero (requirePermesso/can/gateCapability) e citi ` +
        `esattamente questa chiave:\n  ${senzaGate.join('\n  ')}`,
    ).toEqual([]);
  });
});
