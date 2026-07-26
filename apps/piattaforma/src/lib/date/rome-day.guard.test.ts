import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guardia sul giorno di calendario nelle route API.
 *
 * Il runtime su Vercel è UTC: fra mezzanotte UTC e mezzanotte di Roma (un'ora
 * d'inverno, due d'estate) `new Date().toISOString().slice(0, 10)` risponde
 * col giorno PRECEDENTE rispetto a quello che l'utente ha sullo schermo. Il
 * difetto è stato osservato dal vivo alle 01:01 CEST del 27/07/2026: la
 * pagina Finanze diceva ovunque "oggi 27/07", il CSV scaricato si chiamava
 * `...-2026-07-26.csv`. Sui documenti fiscali è peggio di un nome file: la
 * stessa `emessoAt` è già stampata in calendario di Roma su PDF e XML, quindi
 * un export in UTC data una fattura al giorno prima della fattura stessa.
 *
 * `romeIsoDate` (in rome-day.ts, fonte unica del fuso) è la risposta. Questa
 * guardia impedisce che il pattern rientri in una route nuova: è la stessa
 * classe di bug corretta tre volte in questo repo — numerazione fatture, data
 * dei documenti fiscali, nome dei file di export.
 */

// `__dirname` non esiste sotto vitest (ESM). Stesso pattern di periodo.guard.test.ts.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'); // apps/piattaforma
const API_DIR = resolve(ROOT, 'src/app/api');

/**
 * Taglio a giorno di un istante: è QUI che si decide un fuso, ed è il punto in
 * cui va usato `romeIsoDate`. `toISOString()` da solo non è vietato — un
 * timestamp completo in UTC è una scelta legittima.
 */
const PATTERN_VIETATI = ["toISOString().slice(0, 10)", "toISOString().slice(0,10)", "toISOString().split('T')[0]"];

/** Tutte le route API, ricorsivamente (i segmenti dinamici hanno [ ] nel nome). */
function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const voce of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, voce.name);
    if (voce.isDirectory()) out.push(...routeFiles(p));
    else if (voce.name === 'route.ts' || voce.name === 'route.tsx') out.push(p);
  }
  return out;
}

describe('giorno di calendario nelle route API', () => {
  const files = routeFiles(API_DIR);

  it('il censimento trova le route (se no, la guardia non guarda niente)', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('nessuna route taglia un istante a giorno in UTC', () => {
    const colpevoli = files
      .map((f) => ({ rel: relative(ROOT, f), trovati: PATTERN_VIETATI.filter((p) => readFileSync(f, 'utf8').includes(p)) }))
      .filter((r) => r.trovati.length > 0)
      .map((r) => `${r.rel}: ${r.trovati.join(', ')}`);

    expect(
      colpevoli,
      'Queste route tagliano un istante a giorno in UTC:\n' +
        colpevoli.map((c) => `  - ${c}`).join('\n') +
        '\n\nIl runtime su Vercel è UTC: fra mezzanotte UTC e mezzanotte di Roma il risultato è il ' +
        'giorno PRECEDENTE a quello che l\'utente vede a schermo. Su un nome file è una data ' +
        'sbagliata sull\'unico riferimento temporale che resta al documento salvato; su una colonna ' +
        'di data fiscale è una fattura datata al giorno prima della fattura stessa, perché PDF e XML ' +
        'quella data la stampano già in calendario di Roma.\n' +
        'Usa `romeIsoDate(istante)` da @/lib/date/rome-day. Se ti serve davvero un giorno UTC, ' +
        'estrailo in un helper con un nome che lo dica e un commento che spieghi perché.',
    ).toEqual([]);
  });
});
