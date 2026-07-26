import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guardia di non-divergenza: la pagina Finanze e la route di export
 * duplicavano il calcolo del periodo, le due copie sono divergite in
 * silenzio, e dal tab "Ultime 24h" il CSV scaricava un anno intero senza
 * dirlo — il valore `giorno` non esisteva nel `Periodo` locale dell'export e
 * finiva nell'`else` di `anno` (vedi
 * docs/superpowers/specs/2026-07-27-finanze-periodo-personalizzato-design.md).
 * Il fix unifica il calcolo in `periodo.ts`; questa guardia impedisce che
 * qualcuno rimetta tre righe di aritmetica sulle date in uno dei due
 * consumer "per un caso speciale". Struttura (entrambi importano da qui) non
 * basta da sola come garanzia: questo test verifica che nessuno dei due
 * ricalcoli le date per conto proprio.
 */

// `__dirname` non esiste sotto vitest (ESM). Stesso pattern di mappa-pagine.test.ts.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'); // apps/piattaforma

const CONSUMER = [
  { nome: 'pagina Finanze', rel: 'src/app/admin/dashboard/page.tsx' },
  { nome: 'export CSV', rel: 'src/app/api/admin/dashboard/export/route.ts' },
];

/**
 * Aritmetica sulle date fuori da `periodo.ts`: sono gli stessi pattern con
 * cui le due copie preesistenti erano divergite (setter locali per le
 * finestre mobili, `toISOString().slice` per tagliare a giorno).
 */
const PATTERN_VIETATI = ['setMonth(', 'setFullYear(', 'setDate(', 'toISOString().slice'];

describe('periodo: guardia anti-divergenza pagina/export', () => {
  it.each(CONSUMER)('$nome importa il risolutore condiviso', ({ rel }) => {
    const src = readFileSync(resolve(ROOT, rel), 'utf8');
    expect(
      src.includes("from '@/lib/finanze/periodo'"),
      `${rel} deve importare da '@/lib/finanze/periodo': è l'unico punto in cui pagina ed export ` +
        'possono calcolare il periodo. Se questo file non importa più da lì, la garanzia di ' +
        "non-divergenza è sparita ed è di nuovo possibile il bug del CSV a 24h (l'export che " +
        'scaricava un anno intero da "Ultime 24h" perché aveva una sua copia del calcolo).',
    ).toBe(true);
  });

  it.each(CONSUMER)('$nome non ricalcola le date per conto proprio', ({ nome, rel }) => {
    const src = readFileSync(resolve(ROOT, rel), 'utf8');
    const trovati = PATTERN_VIETATI.filter((p) => src.includes(p));
    expect(
      trovati,
      `${rel} (${nome}) contiene ${JSON.stringify(trovati)}. Aritmetica sulle date fuori da ` +
        "'@/lib/finanze/periodo' è esattamente come pagina ed export sono divergiti la prima volta: " +
        'una finestra mobile o un range custom ricalcolati "per un caso speciale" qui non finiscono ' +
        "nell'altro consumer, e le due metriche si disallineano in silenzio (il bug del CSV a 24h). " +
        'Se serve un caso nuovo, va nel risolutore condiviso in periodo.ts, non qui.',
    ).toEqual([]);
  });
});
