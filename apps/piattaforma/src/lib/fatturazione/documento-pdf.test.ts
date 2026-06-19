import { describe, it, expect } from 'vitest';
import {
  documentoPdfInput,
  documentoPdfFilename,
  type DocumentoPdfRecord,
} from './documento-pdf';

const fatturaRecord = (over: Partial<DocumentoPdfRecord> = {}): DocumentoPdfRecord =>
  ({
    tipo: 'FATTURA_PV',
    fatturaPaTipo: 'TD01',
    numeroProgressivo: 42,
    anno: 2026,
    emessoAt: new Date('2026-06-19T10:00:00Z'),
    datiEmittente: { ragioneSociale: 'Passaggio Veloce S.r.l.', partitaIva: '14688390963' },
    datiDestinatario: { ragioneSociale: 'Agenzia Auto S.r.l.', partitaIva: '98765432109' },
    imponibileCent: 4098,
    ivaCent: 902,
    aliquotaIvaPct: 22,
    importoLordoCent: 5000,
    pratica: { codicePratica: 'PV-2026-00042' },
    payout: null,
    notaVariazionePer: null,
    ...over,
  }) as unknown as DocumentoPdfRecord;

describe('documentoPdfFilename', () => {
  it('compone il nome file slug dalla label + numero/anno', () => {
    expect(documentoPdfFilename({ tipo: 'FATTURA_PV', numeroProgressivo: 42, anno: 2026 })).toBe(
      'fattura-42-2026.pdf',
    );
  });

  it('gestisce label multi-parola (es. compenso intermediazione)', () => {
    expect(documentoPdfFilename({ tipo: 'DOC_BROKER', numeroProgressivo: 3, anno: 2026 })).toBe(
      'compenso-intermediazione-3-2026.pdf',
    );
  });
});

describe('documentoPdfInput', () => {
  it('mappa i campi del documento e deriva descrizione/riferimento dalla pratica', () => {
    const input = documentoPdfInput(fatturaRecord());
    expect(input).toMatchObject({
      tipo: 'FATTURA_PV',
      fatturaPaTipo: 'TD01',
      numeroProgressivo: 42,
      anno: 2026,
      imponibileCent: 4098,
      ivaCent: 902,
      aliquotaIvaPct: 22,
      importoLordoCent: 5000,
      descrizione: 'Servizio di intermediazione per passaggio di proprietà',
      riferimento: 'Pratica PV-2026-00042',
    });
    expect(input.emittente.ragioneSociale).toBe('Passaggio Veloce S.r.l.');
    expect(input.destinatario.ragioneSociale).toBe('Agenzia Auto S.r.l.');
  });
});
