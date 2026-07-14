import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAPPA_PAGINE } from './mappa-pagine';

// `__dirname` non esiste sotto vitest (ESM). Stesso pattern di mappa-enforcement.test.ts.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'); // apps/piattaforma
const APP_DIR = resolve(ROOT, 'src/app');

/**
 * Prefissi/percorsi (relativi a `src/app`, sempre con `/` anche su Windows)
 * FUORI dal perimetro "area azienda" — vedi la spiegazione estesa in
 * mappa-pagine.ts. Un file è escluso se il suo percorso relativo a `src/app`
 * comincia con uno di questi prefissi, o coincide con uno di questi path esatti.
 */
const PREFISSI_ESCLUSI = ['admin/', '(auth)/', 'guide/', 'r/', 'invito/'];
const PATH_ESCLUSI_ESATTI = [
  'page.tsx', // la landing pubblica
  'unsubscribe/page.tsx',
  'termini/page.tsx',
  'privacy/page.tsx',
  'privacy/clienti/page.tsx', // informativa ex art. 14 GDPR per venditori/acquirenti senza account: pubblica per costruzione
  'cookie/page.tsx',
];

/** Barre sempre `/`: `path.relative` su Windows ritorna `\`, i prefissi sopra sono scritti in POSIX. */
function toPosix(p: string): string {
  return p.split('\\').join('/');
}

function isAreaAzienda(relFromApp: string): boolean {
  if (PATH_ESCLUSI_ESATTI.includes(relFromApp)) return false;
  return !PREFISSI_ESCLUSI.some((p) => relFromApp.startsWith(p));
}

/** Tutte le `page.tsx` sotto `src/app`, percorso relativo a `ROOT` (`src/app/...`). */
function tuttePagineApp(): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === 'page.tsx') {
        out.push(full);
      }
    }
  }
  walk(APP_DIR);
  return out.map((abs) => toPosix(relative(ROOT, abs)));
}

describe('mappa-pagine', () => {
  it('ogni file mappato esiste', () => {
    for (const rel of Object.keys(MAPPA_PAGINE)) {
      expect(existsSync(resolve(ROOT, rel)), `manca ${rel}`).toBe(true);
    }
  });

  it("ogni page.tsx dell'area azienda è classificata nella mappa", () => {
    const mancanti: string[] = [];
    for (const rel of tuttePagineApp()) {
      const relFromApp_ = rel.replace('src/app/', '');
      if (!isAreaAzienda(relFromApp_)) continue;
      if (!(rel in MAPPA_PAGINE)) mancanti.push(rel);
    }
    expect(
      mancanti,
      `Pagina dell'area azienda senza classificazione. Aggiungila a mappa-pagine.ts col permesso che la ` +
        `protegge (assertPermesso in cima al componente, dopo l'autenticazione), oppure con null e la ragione ` +
        `nel commento (proprio account, owner-only via ruolo, feature parcheggiata, decisione D-xx, ecc.). Se non ` +
        `sei sicuro che debba restare senza gate, mappala comunque a null con la nota "da valutare" e segnalala:\n  ${mancanti.join('\n  ')}`,
    ).toEqual([]);
  });

  it("ogni pagina mappata con un permesso lo cita davvero (assertPermesso('<permesso>')) nel proprio sorgente", () => {
    const senzaGate: string[] = [];
    for (const [rel, permesso] of Object.entries(MAPPA_PAGINE)) {
      if (permesso === null) continue;
      const path = resolve(ROOT, rel);
      if (!existsSync(path)) {
        senzaGate.push(`${rel} → ${permesso} (file non trovato)`);
        continue;
      }
      const src = readFileSync(path, 'utf8');
      if (!src.includes(`assertPermesso('${permesso}')`)) {
        senzaGate.push(`${rel} → ${permesso}`);
      }
    }
    expect(
      senzaGate,
      `Permesso dichiarato in mappa-pagine.ts ma la pagina non chiama assertPermesso('<permesso>') nel proprio ` +
        `sorgente. Una voce nascosta dalla sidebar non è un gate: senza questa chiamata chi digita l'URL entra lo ` +
        `stesso. Aggiungi \`await assertPermesso('<permesso>')\` come prima operazione utile dopo l'autenticazione:\n  ${senzaGate.join('\n  ')}`,
    ).toEqual([]);
  });
});
