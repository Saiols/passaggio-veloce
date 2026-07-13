import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelTipoTx, isPenale, isAffiliazione, CLASSI_RIGA_PENALE } from './movimenti';

/** I valori dell'enum Prisma `TransazioneWalletTipo`, al 2026-07-09. */
const TIPI = [
  'CREDITO_PRATICA',
  'CREDITO_AFFILIAZIONE',
  'PAYOUT_AUTOMATICO',
  'PAYOUT_MANUALE',
  'RETTIFICA_ADMIN',
  'STORNO',
  'PENALE_BROKER',
  'CREDITO_PROMO',
] as const;

describe('isPenale — si evidenzia solo la sanzione', () => {
  it('vero per PENALE_BROKER', () => {
    expect(isPenale('PENALE_BROKER')).toBe(true);
  });

  it.each(TIPI.filter((t) => t !== 'PENALE_BROKER'))('falso per %s', (tipo) => {
    expect(isPenale(tipo)).toBe(false);
  });

  // Lo storno nasce insieme alla penale, ma è il recupero di un compenso già
  // accreditato: due righe rosse per un evento solo sarebbero fuorvianti.
  it('lo STORNO non è una penale', () => {
    expect(isPenale('STORNO')).toBe(false);
  });

  it('un tipo sconosciuto non viene evidenziato', () => {
    expect(isPenale('TIPO_CHE_NON_ESISTE')).toBe(false);
  });
});

// La riga di una commissione di affiliazione parla di una pratica che NON è di
// chi la sta guardando: è dell'affiliato. Da qui dipende se la UI mostra il link
// al dettaglio e la targa (wallet/page.tsx) — sbagliare a dire "sì" su un tipo
// qualsiasi significa esporre i dati di una pratica altrui.
describe('isAffiliazione — la pratica collegata è di un altro soggetto', () => {
  it('vero per CREDITO_AFFILIAZIONE', () => {
    expect(isAffiliazione('CREDITO_AFFILIAZIONE')).toBe(true);
  });

  it.each(TIPI.filter((t) => t !== 'CREDITO_AFFILIAZIONE'))('falso per %s', (tipo) => {
    expect(isAffiliazione(tipo)).toBe(false);
  });

  // Il credito della pratica PROPRIA è l'altra faccia della medaglia: lì il link
  // al dettaglio ci deve stare, la pratica è di chi guarda.
  it('CREDITO_PRATICA non è affiliazione: quella pratica è mia', () => {
    expect(isAffiliazione('CREDITO_PRATICA')).toBe(false);
  });

  it('un tipo sconosciuto non è affiliazione', () => {
    expect(isAffiliazione('TIPO_CHE_NON_ESISTE')).toBe(false);
  });
});

describe('labelTipoTx', () => {
  it('etichetta i tipi noti', () => {
    expect(labelTipoTx('PENALE_BROKER')).toBe('Penale segnalazione');
    expect(labelTipoTx('CREDITO_PRATICA')).toBe('Credito pratica firmata');
    expect(labelTipoTx('PAYOUT_MANUALE')).toBe('Payout manuale');
  });

  it('ricade sul valore grezzo per un tipo sconosciuto', () => {
    expect(labelTipoTx('TIPO_CHE_NON_ESISTE')).toBe('TIPO_CHE_NON_ESISTE');
  });
});

describe('CLASSI_RIGA_PENALE', () => {
  it('usa i token del design system, non colori hardcoded', () => {
    expect(CLASSI_RIGA_PENALE).toContain('bg-pv-red-50');
    expect(CLASSI_RIGA_PENALE).toContain('--color-pv-red-500');
    expect(CLASSI_RIGA_PENALE).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

describe('contratto con lo schema: ogni tipo ha un\'etichetta', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const SCHEMA_PATH = path.resolve(here, '../../../../../packages/db/prisma/schema.prisma');
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const match = schema.match(/enum TransazioneWalletTipo \{([\s\S]*?)\n\}/);
  if (!match) throw new Error('enum TransazioneWalletTipo non trovato in schema.prisma');
  const valoriSchema = match[1]
    .split('\n')
    .map((r) => r.trim())
    .filter((r) => r.length > 0 && !r.startsWith('//'));

  it('la lista di questo test è allineata allo schema', () => {
    expect([...valoriSchema].sort()).toEqual([...TIPI].sort());
  });

  it.each(valoriSchema)('%s ha un\'etichetta leggibile, non il valore grezzo', (tipo) => {
    expect(labelTipoTx(tipo)).not.toBe(tipo);
  });
});
