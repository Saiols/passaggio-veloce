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

/**
 * Ritaglia il corpo di UNA dichiarazione top-level `function <nome>` (con o
 * senza `export`/`async` davanti): dall'inizio della riga della dichiarazione
 * fino all'inizio della successiva dichiarazione top-level — `\nexport `,
 * `\nasync function ` o `\nfunction ` a colonna 0 — oppure fino a fine file.
 *
 * Non è un parser: è un ritaglio conservativo via regex. Serve a non
 * confondere "la stringa compare da qualche parte nel file" con "la stringa
 * compare in QUESTA funzione" — la differenza che il drift sfrutta quando due
 * action nello stesso file si scambiano il permesso (vedi test sotto).
 *
 * Ritorna `null` se `nome` non è dichiarato nel file.
 */
function corpoFunzione(src: string, nome: string): string | null {
  const declRe = new RegExp(`\\bfunction\\s+${nome}\\b`);
  const decl = declRe.exec(src);
  if (!decl) return null;

  // Risale all'inizio della riga per includere l'eventuale `export`/`async`
  // che precede `function` sulla stessa riga.
  const lineStart = src.lastIndexOf('\n', decl.index - 1) + 1;

  // Il confine successivo si cerca PARTENDO da dopo la firma di questa stessa
  // dichiarazione, altrimenti il primo "match" sarebbe lei stessa.
  const searchFrom = decl.index + decl[0].length;
  const boundaryRe = /\n(?:export |async function |function )/g;
  boundaryRe.lastIndex = searchFrom;
  const boundary = boundaryRe.exec(src);
  const bodyEnd = boundary ? boundary.index + 1 : src.length;

  return src.slice(lineStart, bodyEnd);
}

/**
 * Un solo livello di indirezione: se il corpo dell'action non cita il
 * permesso ma chiama un identificatore `nomeHelper(` per cui esiste una
 * `function nomeHelper` NELLO STESSO FILE, e il corpo di QUELL'helper cita il
 * permesso, va bene lo stesso (es. le sei action OCR di pratiche/nuova/actions.ts
 * che chiamano `gateCreazione()`, o i wrapper lista/dettaglio di
 * pratiche/actions.ts che chiamano un *Core condiviso).
 *
 * Volutamente non ricorsivo: se il gate fosse più lontano di un helper diretto,
 * l'action non sarebbe più leggibile guardando solo se stessa, e la mappa
 * dovrebbe dirlo esplicitamente (o il codice andrebbe riavvicinato).
 */
function citaPermessoViaHelper(
  src: string,
  corpoAction: string,
  nomeAction: string,
  permesso: string,
): boolean {
  const chiamate = [...corpoAction.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]);
  const candidati = [...new Set(chiamate)].filter((h) => h !== nomeAction);
  return candidati.some((h) => {
    const corpoHelper = corpoFunzione(src, h);
    return corpoHelper !== null && corpoHelper.includes(`'${permesso}'`);
  });
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

  it('ogni action classificata con un permesso lo cita davvero nella propria funzione (o in un helper diretto)', () => {
    const senzaGate: string[] = [];
    for (const [rel, actions] of Object.entries(MAPPA_ENFORCEMENT)) {
      const src = readFileSync(resolve(ROOT, rel), 'utf8');
      for (const [nome, permesso] of Object.entries(actions)) {
        if (permesso === null) continue;

        const corpo = corpoFunzione(src, nome);
        if (corpo === null) {
          // La mappa punta a un nome che non esiste più (o mai esistito) nel
          // file: rinominala/rimuovila in mappa-enforcement.ts.
          senzaGate.push(`${rel}:${nome} → ${permesso} (funzione non trovata nel sorgente)`);
          continue;
        }
        if (corpo.includes(`'${permesso}'`)) continue;
        if (citaPermessoViaHelper(src, corpo, nome, permesso)) continue;

        senzaGate.push(`${rel}:${nome} → ${permesso}`);
      }
    }
    expect(
      senzaGate,
      `Permesso dichiarato in mappa-enforcement.ts ma non citato né nel corpo della funzione né in un helper ` +
        `diretto che essa chiama (un solo livello di indirezione — non ricorsivo). Prima di "aggiustare" questo ` +
        `test allargando di nuovo la ricerca a tutto il file: il punto della guardia è proprio impedire che un ` +
        `refactor sposti o scambi un gate fra due action senza che nessun test se ne accorga. Verifica invece che ` +
        `il gate esista davvero (requirePermesso/can/gateCapability), che citi ESATTAMENTE questa chiave nella ` +
        `funzione giusta, oppure in un helper dichiarato nello stesso file e chiamato direttamente da essa:\n  ${senzaGate.join('\n  ')}`,
    ).toEqual([]);
  });
});
