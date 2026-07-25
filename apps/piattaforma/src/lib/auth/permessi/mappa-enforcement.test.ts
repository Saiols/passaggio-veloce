import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPPA_ENFORCEMENT } from './mappa-enforcement';
import { MAPPA_SOSPENSIONE } from './mappa-sospensione';

// `__dirname` non esiste sotto vitest (ESM). Stesso pattern di
// src/lib/notifiche/pratica-schema.test.ts e degli altri test che leggono file.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'); // apps/piattaforma

/**
 * Perimetro ESCLUSO dall'enumerazione filesystem sotto: aree con un dominio di
 * autorizzazione diverso da quello azienda (il catalogo `Permesso` qui in
 * ./catalogo riguarda SOLO utenti azienda dealer/agenzia), o senza sessione.
 * Stesso perimetro (e stessa motivazione) di mappa-pagine.ts:
 *  - `src/app/admin/**`   staff piattaforma: gate a ruolo
 *    (ADMIN_PIATTAFORMA/ASSISTENTE via isAdminPiattaforma/isAdminOrAssistente),
 *    non il catalogo permessi azienda.
 *  - `src/app/(auth)/**`  route group pre-sessione: login, registrazione,
 *    reset password. Non c'è ancora un utente da gatare.
 */
const PREFISSI_ESCLUSI_ENFORCEMENT = ['src/app/admin/', 'src/app/(auth)/'];

/** Barre sempre `/`: `path.relative` su Windows ritorna `\`. */
function toPosix(p: string): string {
  return p.split('\\').join('/');
}

function isFuoriPerimetroEnforcement(rel: string): boolean {
  return PREFISSI_ESCLUSI_ENFORCEMENT.some((p) => rel.startsWith(p));
}

/**
 * Un file è un "modulo di server action" quando `'use server'` è la PRIMA
 * istruzione non vuota del file — la direttiva file-level che rende server
 * action ogni funzione esportata (convenzione Next.js usata da tutti gli
 * `actions.ts` del progetto). Non basta che la stringa `'use server'` compaia
 * da qualche parte: due `page.tsx` (`orari/page.tsx`, `sedi/[id]/page.tsx`)
 * la usano come direttiva PER-FUNZIONE dentro una closure inline che delega
 * a un'action già mappata altrove — un pattern diverso, coperto da
 * mappa-pagine.test.ts (il gate della pagina) e da questa stessa mappa (il
 * gate dell'action delegata). Trattarli come "nuovo file azioni" darebbe un
 * falso positivo permanente senza aggiungere protezione reale.
 */
function isFileAzioni(src: string): boolean {
  const primaRiga = src
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return primaRiga === "'use server';" || primaRiga === '"use server";';
}

/** Tutti i file `.ts`/`.tsx` con `'use server'` file-level sotto `dir`. */
function tuttiIFileAzioni(dir: string): string[] {
  const out: string[] = [];
  function walk(d: string): void {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        if (isFileAzioni(readFileSync(full, 'utf8'))) out.push(full);
      }
    }
  }
  walk(dir);
  return out;
}

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
 * Modulo specifier importato per un identificatore nominato, es.
 * `import { firmaPraticaCore } from '@/lib/pratiche/firma-engine'` per
 * `nomeLocale = 'firmaPraticaCore'` ritorna `'@/lib/pratiche/firma-engine'`.
 * Gestisce anche `import { x as y }` (confronta il nome LOCALE, cioè `y`).
 */
function specificatoreModulo(src: string, nomeLocale: string): string | null {
  const importRe = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src))) {
    const nomi = m[1].split(',').map((s) => s.trim());
    for (const n of nomi) {
      if (!n) continue;
      const parti = n.split(/\s+as\s+/).map((s) => s.trim());
      const locale = parti.length > 1 ? parti[1] : parti[0];
      if (locale === nomeLocale) return m[2];
    }
  }
  return null;
}

/**
 * Risolve uno specifier di import ('@/...' o relativo) al path del file
 * (relativo a ROOT), provando le estensioni `.ts`/`.tsx`. `null` se non è un
 * modulo locale (pacchetto esterno tipo `@pv/db`, `next/navigation`) o se il
 * file risolto non esiste.
 */
function risolviModuloLocale(relFileChiamante: string, specifier: string): string | null {
  let relSenzaEstensione: string;
  if (specifier.startsWith('@/')) {
    relSenzaEstensione = `src/${specifier.slice(2)}`;
  } else if (specifier.startsWith('.')) {
    relSenzaEstensione = toPosix(join(dirname(relFileChiamante), specifier));
  } else {
    return null;
  }
  for (const ext of ['.ts', '.tsx']) {
    const candidato = `${relSenzaEstensione}${ext}`;
    if (existsSync(resolve(ROOT, candidato))) return candidato;
  }
  return null;
}

/**
 * Un solo livello di indirezione: se il corpo dell'action non cita il
 * permesso ma chiama un identificatore `nomeHelper(` per cui esiste una
 * `function nomeHelper` NELLO STESSO FILE, e il corpo di QUELL'helper cita il
 * permesso, va bene lo stesso (es. le sei action OCR di pratiche/nuova/actions.ts
 * che chiamano `gateCreazione()`, o i wrapper lista/dettaglio di
 * pratiche/actions.ts che chiamano un *Core condiviso).
 *
 * Lo stesso hop vale se l'helper è importato da un modulo locale (alias `@/`
 * o path relativo) invece che dichiarato nel file: un motore condiviso fra più
 * percorsi (es. firma agenzia + firma admin) non può vivere in un file
 * `'use server'`, perché lì ogni export diventa un endpoint HTTP invocabile dal
 * client — deve stare in un modulo a parte. Resta comunque UN hop: non si
 * segue l'import a sua volta dentro le funzioni che chiama.
 *
 * Volutamente non ricorsivo oltre questo: se il gate fosse più lontano di un
 * helper diretto (in-file o importato), l'action non sarebbe più leggibile
 * guardando solo se stessa e il suo import diretto, e la mappa dovrebbe dirlo
 * esplicitamente (o il codice andrebbe riavvicinato).
 */
function citaPermessoViaHelper(
  src: string,
  corpoAction: string,
  nomeAction: string,
  permesso: string,
  rel: string,
): boolean {
  const chiamate = [...corpoAction.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]);
  const candidati = [...new Set(chiamate)].filter((h) => h !== nomeAction);
  return candidati.some((h) => {
    const corpoHelper = corpoFunzione(src, h);
    if (corpoHelper !== null) return corpoHelper.includes(`'${permesso}'`);

    const spec = specificatoreModulo(src, h);
    if (!spec) return false;
    const modRel = risolviModuloLocale(rel, spec);
    if (!modRel) return false;
    const modSrc = readFileSync(resolve(ROOT, modRel), 'utf8');
    const corpoHelperEsterno = corpoFunzione(modSrc, h);
    return corpoHelperEsterno !== null && corpoHelperEsterno.includes(`'${permesso}'`);
  });
}

describe('mappa-enforcement', () => {
  it('ogni file mappato esiste', () => {
    for (const rel of Object.keys(MAPPA_ENFORCEMENT)) {
      expect(existsSync(resolve(ROOT, rel)), `manca ${rel}`).toBe(true);
    }
  });

  it("nessun modulo di server action sfugge alla mappa (blindspot: file interamente nuovo)", () => {
    const trovati = [
      ...tuttiIFileAzioni(resolve(ROOT, 'src/app')),
      ...tuttiIFileAzioni(resolve(ROOT, 'src/lib')),
    ]
      .map((abs) => toPosix(relative(ROOT, abs)))
      .filter((rel) => !isFuoriPerimetroEnforcement(rel));

    const nonMappati = trovati.filter((rel) => !(rel in MAPPA_ENFORCEMENT));
    expect(
      nonMappati,
      `File con 'use server' (direttiva file-level) fuori da mappa-enforcement.ts. Prima di questo test, un file ` +
        `actions.ts INTERAMENTE NUOVO sfuggiva alla guardia: nessuno lo aggiungeva alla mappa, nessun test diventava ` +
        `rosso — questo è il buco che il test chiude. Aggiungi il file a MAPPA_ENFORCEMENT con le sue server action ` +
        `classificate (permesso o null con la ragione):\n  ${nonMappati.join('\n  ')}`,
    ).toEqual([]);
  }, 20_000);

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
        if (citaPermessoViaHelper(src, corpo, nome, permesso, rel)) continue;

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

/** Il corpo dell'action, o di un helper diretto, cita `requireOperativita`. */
function citaGuardOperativita(src: string, corpo: string, nomeAction: string): boolean {
  if (corpo.includes('requireOperativita')) return true;
  const chiamate = [...corpo.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]);
  return [...new Set(chiamate)]
    .filter((h) => h !== nomeAction)
    .some((h) => {
      const corpoHelper = corpoFunzione(src, h);
      return corpoHelper !== null && corpoHelper.includes('requireOperativita');
    });
}

describe('mappa-sospensione', () => {
  it('classifica esattamente le action senza permesso delegabile', () => {
    const attese: string[] = [];
    for (const [rel, actions] of Object.entries(MAPPA_ENFORCEMENT)) {
      for (const [nome, permesso] of Object.entries(actions)) {
        if (permesso === null) attese.push(`${rel}:${nome}`);
      }
    }
    const dichiarate: string[] = [];
    for (const [rel, actions] of Object.entries(MAPPA_SOSPENSIONE)) {
      for (const nome of Object.keys(actions)) dichiarate.push(`${rel}:${nome}`);
    }
    expect(
      dichiarate.sort(),
      'MAPPA_SOSPENSIONE deve coprire ESATTAMENTE le action a permesso null di ' +
        'MAPPA_ENFORCEMENT: quelle gated da un permesso hanno il comportamento già ' +
        'derivato dalla partizione lettura/scrittura e non vanno ripetute qui.',
    ).toEqual(attese.sort());
  });

  it("ogni action marcata BLOCCA chiama davvero requireOperativita", () => {
    const senzaGuard: string[] = [];
    for (const [rel, actions] of Object.entries(MAPPA_SOSPENSIONE)) {
      const src = readFileSync(resolve(ROOT, rel), 'utf8');
      for (const [nome, esito] of Object.entries(actions)) {
        if (esito !== 'BLOCCA') continue;
        const corpo = corpoFunzione(src, nome);
        if (corpo === null) {
          senzaGuard.push(`${rel}:${nome} (funzione non trovata nel sorgente)`);
          continue;
        }
        if (!citaGuardOperativita(src, corpo, nome)) senzaGuard.push(`${rel}:${nome}`);
      }
    }
    expect(
      senzaGuard,
      'Action marcata BLOCCA in mappa-sospensione.ts ma che non chiama ' +
        'requireOperativita() né direttamente né in un helper dichiarato nello stesso ' +
        'file:\n  ' + senzaGuard.join('\n  '),
    ).toEqual([]);
  }, 20_000);
});
