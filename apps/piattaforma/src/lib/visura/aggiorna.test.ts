import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique, update, create, txMock, atecoFindMany } = vi.hoisted(() => ({
  findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), txMock: vi.fn(),
  atecoFindMany: vi.fn(),
}));
vi.mock('@pv/db', () => ({
  prisma: {
    company: { findUnique },
    atecoAllowedCode: { findMany: atecoFindMany },
    $transaction: txMock,
  },
  Prisma: {},
}));
vi.mock('@/lib/providers/storage', () => ({
  storageGetBuffer: vi.fn(async () => Buffer.from('pdf')),
  getStorage: () => ({ name: 'local' }),
}));
vi.mock('@/env', () => ({ env: { OCR_PROVIDER: 'mock' } }));
vi.mock('server-only', () => ({}));

import { aggiornaVisura, verificaVisuraPerAggiornamento } from './aggiorna';

const REF = { key: 'visura/x.pdf', name: 'visura.pdf', size: 1000, type: 'application/pdf' };
const NOW = new Date('2026-07-16T12:00:00Z');
const AZIENDA = {
  id: 'c1', type: 'DEALER', ragioneSociale: 'Rossi Auto', partitaIva: '12345678901',
};
const SEDE_OK = { indirizzo: 'VIA CORRETTA 1', cap: '20100', citta: 'MILANO', provincia: 'MI' };
const VISURA_OK = {
  dataEmissione: '2026-07-01', partitaIva: '12345678901', denominazione: 'Rossi Auto',
  atecoCodes: ['45.11.01'],
  // Deve contenere la P.IVA di AZIENDA (12345678901): è il nuovo controllo
  // 2b in `eseguiControlli` (P.IVA nel testo grezzo, non solo companyMatches).
  rawText: 'VISURA CAMERALE ORDINARIA - Denominazione: Rossi Auto - P.IVA 12345678901',
};
const deps = (v: object) => ({ getVisura: vi.fn(async () => v as never) });

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(AZIENDA);
  // AtecoAllowedCode.code è normalizzato SENZA punti (cfr. schema.prisma:
  // "normalizzato senza punti, es. 4511" e lib/kyc/ateco.test.ts). '45.11.01'
  // con i punti non matcherebbe mai via startsWith: era un difetto del brief.
  atecoFindMany.mockResolvedValue([{ companyType: 'DEALER', code: '4511', active: true }]);
  txMock.mockImplementation(async (fn: never) =>
    (fn as unknown as (tx: unknown) => unknown)({
      company: { update }, documento: { create },
    }),
  );
});

describe('aggiornaVisura — controlli', () => {
  it('data illeggibile → rifiuta', async () => {
    const r = await aggiornaVisura({ companyId: 'c1', userId: 'u1', ref: REF, sedeLegale: SEDE_OK, now: NOW },
      deps({ ...VISURA_OK, dataEmissione: undefined }));
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('senza P.IVA né denominazione → rifiuta (illeggibile)', async () => {
    const r = await aggiornaVisura({ companyId: 'c1', userId: 'u1', ref: REF, sedeLegale: SEDE_OK, now: NOW },
      deps({ ...VISURA_OK, partitaIva: undefined, denominazione: undefined }));
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('P.IVA di un\'ALTRA azienda → rifiuta (non e\' un aggiornamento, e\' un mismatch)', async () => {
    const r = await aggiornaVisura({ companyId: 'c1', userId: 'u1', ref: REF, sedeLegale: SEDE_OK, now: NOW },
      deps({ ...VISURA_OK, partitaIva: '99999999999', denominazione: 'Altra Srl' }));
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('visura di un OMONIMO con P.IVA diversa: rifiutata (companyMatches da solo non basta)', async () => {
    // Stesso nome normalizzato di AZIENDA ("Rossi Auto") → companyMatches
    // passerebbe DA SOLO via denominazione. Il testo grezzo però non contiene
    // la P.IVA di c1 (12345678901): è la visura di un altro "Rossi Auto".
    const r = await aggiornaVisura(
      { companyId: 'c1', userId: 'u1', ref: REF, sedeLegale: SEDE_OK, now: NOW },
      deps({
        ...VISURA_OK,
        partitaIva: '99999999999',
        denominazione: 'Rossi Auto',
        rawText: 'VISURA CAMERALE ORDINARIA - Denominazione: Rossi Auto - P.IVA 99999999999',
      }),
    );
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('la propria visura passa anche se PIVA_RE ha pescato il CF di un socio', async () => {
    // `visura.partitaIva` non è quello di c1 (è il CF/P.IVA di una società
    // socia, primo run di 11 cifre nel testo): il check 2b non lo usa, cerca
    // la P.IVA di c1 in TUTTO il rawText, dove compare comunque (con punti,
    // come farebbe un OCR reale).
    const r = await aggiornaVisura(
      { companyId: 'c1', userId: 'u1', ref: REF, sedeLegale: SEDE_OK, now: NOW },
      deps({
        ...VISURA_OK,
        partitaIva: '12682930966',
        rawText:
          'VISURA CAMERALE ORDINARIA - Denominazione: Rossi Auto - Soci: ' +
          'ALTRA SOCIETA SRL C.F. 12682930966 - P.IVA 12.345.678.901',
      }),
    );
    expect(r.ok).toBe(true);
    expect(update).toHaveBeenCalled();
  });

  it('visura gia\' oltre i 180 giorni → rifiuta (non sbloccherebbe nulla)', async () => {
    const r = await aggiornaVisura({ companyId: 'c1', userId: 'u1', ref: REF, sedeLegale: SEDE_OK, now: NOW },
      deps({ ...VISURA_OK, dataEmissione: '2024-12-13' }));
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('data non calendariale (2026-02-31, rollover silenzioso) → rifiuta, non scrive una data sbagliata', async () => {
    const r = await aggiornaVisura({ companyId: 'c1', userId: 'u1', ref: REF, sedeLegale: SEDE_OK, now: NOW },
      deps({ ...VISURA_OK, dataEmissione: '2026-02-31' }));
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('data non calendariale (2026-17-35, mese/giorno fuori range) → rifiuta, non passa fail-open', async () => {
    const r = await aggiornaVisura({ companyId: 'c1', userId: 'u1', ref: REF, sedeLegale: SEDE_OK, now: NOW },
      deps({ ...VISURA_OK, dataEmissione: '2026-17-35' }));
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('ATECO non ammesso → ACCETTA e segnala (mai un vicolo cieco)', async () => {
    atecoFindMany.mockResolvedValue([{ companyType: 'DEALER', code: '4511', active: true }]);
    const r = await aggiornaVisura({ companyId: 'c1', userId: 'u1', ref: REF, sedeLegale: SEDE_OK, now: NOW },
      deps({ ...VISURA_OK, atecoCodes: ['99.99.99'] }));
    expect(r.ok).toBe(true);
    expect(r.ok && r.atecoNonIdoneo).toBe(true);
    expect(update).toHaveBeenCalled();
  });

  it('azienda non trovata → rifiuta senza scrivere', async () => {
    findUnique.mockResolvedValue(null);
    const r = await aggiornaVisura({ companyId: 'nope', userId: 'u1', ref: REF, sedeLegale: SEDE_OK, now: NOW },
      deps(VISURA_OK));
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('aggiornaVisura — cosa scrive', () => {
  it('aggiorna data, ragione sociale e sede legale; MAI la P.IVA né il regime', async () => {
    await aggiornaVisura({ companyId: 'c1', userId: 'u1', ref: REF, sedeLegale: SEDE_OK, now: NOW },
      deps({ ...VISURA_OK, denominazione: 'Rossi Auto Srl' }));
    const data = update.mock.calls[0]![0].data;
    expect(data.visuraCameraleData).toEqual(new Date('2026-07-01T00:00:00Z'));
    expect(data.ragioneSociale).toBe('Rossi Auto Srl');
    // Gating di un campo = OMETTERE la chiave: calcolarla a null AZZERA il dato.
    expect('partitaIva' in data).toBe(false);
    expect('regimeFiscale' in data).toBe(false);
    // Stesso trattamento per `civico`: nessun consumer lo legge (non esiste
    // `NumeroCivico` nello XML FatturaPA, `snapshotCompany` non lo accetta
    // nemmeno nel tipo), quindi la chiave va OMESSA, non scritta.
    expect('civico' in data).toBe(false);
  });

  it('la sede legale viene dal FORM, non dall\'OCR', async () => {
    await aggiornaVisura(
      { companyId: 'c1', userId: 'u1', ref: REF, now: NOW, sedeLegale: SEDE_OK },
      deps({
        ...VISURA_OK,
        sedeLegale: { indirizzo: 'VIA SBAGLIATA', comune: 'ROMA', provincia: 'RM', cap: '00100' },
      }),
    );
    const data = update.mock.calls[0]![0].data;
    // `indirizzo` è scritto COL civico dentro, com'è il testo che dà il form:
    // `civico` è l'unico campo della sede che NON raggiunge la fattura, quindi
    // il numero deve stare dentro `indirizzo` o si perde (vedi `aggiornaVisura`).
    expect(data.indirizzo).toBe('VIA CORRETTA 1'); // vince l'umano
    expect(data.cap).toBe('20100');
    expect(data.citta).toBe('MILANO');
    expect(data.provincia).toBe('MI');
  });

  it('la DATA viene dall\'OCR, mai dal chiamante (tentativo di override ignorato)', async () => {
    await aggiornaVisura(
      { companyId: 'c1', userId: 'u1', ref: REF, now: NOW, sedeLegale: SEDE_OK, dataEmissione: '2026-07-16' } as never,
      deps({ ...VISURA_OK, dataEmissione: '2026-07-01' }),
    );
    expect(update.mock.calls[0]![0].data.visuraCameraleData).toEqual(new Date('2026-07-01T00:00:00Z'));
  });

  it('AGGIUNGE un Documento, non ne sostituisce/cancella nessuno', async () => {
    await aggiornaVisura({ companyId: 'c1', userId: 'u1', ref: REF, sedeLegale: SEDE_OK, now: NOW }, deps(VISURA_OK));
    expect(create).toHaveBeenCalledTimes(1);
    const d = create.mock.calls[0]![0].data;
    expect(d.tipo).toBe('VISURA_CAMERALE');
    expect(d.companyId).toBe('c1');
    expect(d.storageKey).toBe(REF.key);
    expect(d.uploadedById).toBe('u1');
    expect(d.ocrProvider).toBe('mock');
    expect(d.gatingStato).toBe('PASSED');
    // Nessun soft-delete dei precedenti: il cron purge-deleted-documenti li
    // cancellerebbe e lo storico e' un requisito.
    expect(d.deletedAt).toBeUndefined();
    // ADD, non replace: non passa mai un praticaId (documento anagrafico aziendale).
    expect(d.praticaId).toBeUndefined();
  });
});

describe('verificaVisuraPerAggiornamento — passo 1: non scrive nulla', () => {
  it('visura idonea → ritorna anteprima senza scrivere', async () => {
    const r = await verificaVisuraPerAggiornamento({ companyId: 'c1', ref: REF, now: NOW }, deps(VISURA_OK));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dataEmissione).toBe('2026-07-01');
      expect(r.ragioneSociale).toBe('Rossi Auto');
      expect(r.atecoNonIdoneo).toBe(false);
      expect(r.sedeLegale).toBeUndefined();
    }
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(txMock).not.toHaveBeenCalled();
  });

  it('espone la sede legale estratta (best-effort) per precompilare il form', async () => {
    const sedeLegale = { comune: 'MILANO', provincia: 'MI', indirizzo: 'VIA ROMA 1', cap: '20100' };
    const r = await verificaVisuraPerAggiornamento(
      { companyId: 'c1', ref: REF, now: NOW },
      deps({ ...VISURA_OK, sedeLegale }),
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.sedeLegale).toEqual(sedeLegale);
    expect(update).not.toHaveBeenCalled();
  });

  it('applica GLI STESSI controlli del passo 2: rifiuta un mismatch senza scrivere', async () => {
    const r = await verificaVisuraPerAggiornamento(
      { companyId: 'c1', ref: REF, now: NOW },
      deps({ ...VISURA_OK, partitaIva: '99999999999', denominazione: 'Altra Srl' }),
    );
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('applica GLI STESSI controlli del passo 2: rifiuta una visura scaduta', async () => {
    const r = await verificaVisuraPerAggiornamento(
      { companyId: 'c1', ref: REF, now: NOW },
      deps({ ...VISURA_OK, dataEmissione: '2024-12-13' }),
    );
    expect(r.ok).toBe(false);
  });

  it('ATECO non ammesso → non blocca l\'anteprima, la segnala', async () => {
    const r = await verificaVisuraPerAggiornamento(
      { companyId: 'c1', ref: REF, now: NOW },
      deps({ ...VISURA_OK, atecoCodes: ['99.99.99'] }),
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.atecoNonIdoneo).toBe(true);
  });

  it('azienda non trovata → rifiuta', async () => {
    findUnique.mockResolvedValue(null);
    const r = await verificaVisuraPerAggiornamento({ companyId: 'nope', ref: REF, now: NOW }, deps(VISURA_OK));
    expect(r.ok).toBe(false);
  });
});
