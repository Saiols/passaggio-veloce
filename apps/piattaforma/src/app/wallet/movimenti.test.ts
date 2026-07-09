import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelTipoTx, isPenale, CLASSI_RIGA_PENALE } from './movimenti';

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
