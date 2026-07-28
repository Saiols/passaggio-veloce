import { describe, it, expect, vi, beforeEach } from 'vitest';

const contactUpdateMany = vi.fn();
vi.mock('@pv/db', () => ({
  prisma: { crmContact: { updateMany: (...a: unknown[]) => contactUpdateMany(...a) } },
}));

import { applicaArricchimento } from './arricchimento-scrittura';
import type { ContattoDaArricchire } from './arricchimento';

const LETTO: ContattoDaArricchire & { arricchitoDa: string | null } = {
  email: null, wa: null, piva: null,
  indirizzo: null, citta: '  ', cap: '20094', regione: null,
  arricchitoDa: null,
};

const PATCH = {
  dati: { email: 'info@agenzia.it', citta: 'Corsico' },
  campi: ['email', 'citta'] as const,
};

describe('applicaArricchimento', () => {
  beforeEach(() => {
    contactUpdateMany.mockReset();
    contactUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('scrive i campi, le norm e l\'audit', async () => {
    expect(await applicaArricchimento('x1', { ...PATCH, campi: [...PATCH.campi] }, LETTO)).toBe(true);
    const { data } = contactUpdateMany.mock.calls[0]![0];
    expect(data.email).toBe('info@agenzia.it');
    expect(data.citta).toBe('Corsico');
    expect(data.emailNorm).toBe('info@agenzia.it');
    expect(data.arricchitoDa).toBe('email,citta');
    expect(data.arricchitoAt).toBeInstanceOf(Date);
    // telNorm non è nei dati: il telefono non si tocca mai
    expect(data).not.toHaveProperty('telNorm');
  });

  it('compare-and-set sul valore letto, non su null', async () => {
    await applicaArricchimento('x1', { ...PATCH, campi: [...PATCH.campi] }, LETTO);
    const { where } = contactUpdateMany.mock.calls[0]![0];
    // `citta` era '  ' (soli spazi): il where deve confrontare ESATTAMENTE
    // quel valore, altrimenti la riga non viene trovata e il campo resta
    // vuoto per sempre senza che nulla lo segnali.
    expect(where).toEqual({ id: 'x1', deletedAt: null, email: null, citta: '  ', arricchitoDa: null });
  });

  it('qualcuno ha compilato il campo nel frattempo → non scrive, torna false', async () => {
    contactUpdateMany.mockResolvedValue({ count: 0 });
    expect(await applicaArricchimento('x1', { ...PATCH, campi: [...PATCH.campi] }, LETTO)).toBe(false);
  });

  it('l\'audit precedente non si perde', async () => {
    await applicaArricchimento(
      'x1',
      { dati: { wa: '3331234567' }, campi: ['wa'] },
      { ...LETTO, arricchitoDa: 'email' },
    );
    expect(contactUpdateMany.mock.calls[0]![0].data.arricchitoDa).toBe('email,wa');
  });

  it('la guardia include arricchitoDa letto, non solo i campi dati (evita il lost update sull\'audit)', async () => {
    // Processo A ha già scritto `citta` (arricchitoDa: 'citta') fra la lettura
    // di B e la sua scrittura. La patch di B tocca solo `wa`: se il `where`
    // guardasse solo `patch.campi`, la CAS su `wa: null` passerebbe comunque e
    // B sovrascriverebbe l'audit di A con 'wa', perdendo 'citta' in silenzio.
    // Includere `arricchitoDa` nel `where` fa fallire la CAS in questo
    // scenario: `count` torna 0, nessun campo viene scritto in questo giro
    // (nemmeno quelli ancora vuoti), e li riprende la passata successiva.
    await applicaArricchimento(
      'x1',
      { dati: { wa: '3331234567' }, campi: ['wa'] },
      { ...LETTO, arricchitoDa: null },
    );
    expect(contactUpdateMany.mock.calls[0]![0].where).toHaveProperty('arricchitoDa', null);

    contactUpdateMany.mockClear();
    await applicaArricchimento(
      'x1',
      { dati: { wa: '3331234567' }, campi: ['wa'] },
      { ...LETTO, arricchitoDa: 'email' },
    );
    expect(contactUpdateMany.mock.calls[0]![0].where).toHaveProperty('arricchitoDa', 'email');
  });
});
