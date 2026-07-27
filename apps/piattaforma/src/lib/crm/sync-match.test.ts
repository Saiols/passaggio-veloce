import { describe, it, expect, vi, beforeEach } from 'vitest';

const calcolaProposte = vi.fn();
const applicaProposte = vi.fn();
vi.mock('./match/engine', () => ({ calcolaProposte: (...a: unknown[]) => calcolaProposte(...a) }));
vi.mock('./match/apply', () => ({ applicaProposte: (...a: unknown[]) => applicaProposte(...a) }));
vi.mock('@pv/db', () => ({ prisma: {}, CrmFonteAcquisizione: { REFERRAL: 'REFERRAL' } }));

import { tryMatchCrmContact } from './sync';

const PROPOSTA = {
  contactId: 'x1',
  contactNome: 'Agenzia Corsico Pratiche Auto',
  contactTel: null,
  contactCitta: null,
  companyId: 'c1',
  companyNome: 'AGENZIA CORSICO',
  sedeId: null,
  sedeNome: null,
  cat: 'AGENZIA',
  punteggio: 80,
  campi: ['tel', 'indirizzo'],
  registrataAt: new Date('2026-01-10T00:00:00Z'),
  ambigua: false,
};

describe('tryMatchCrmContact', () => {
  beforeEach(() => {
    calcolaProposte.mockReset();
    applicaProposte.mockReset();
  });

  it('cerca solo per quella company e applica', async () => {
    calcolaProposte.mockResolvedValue([PROPOSTA]);
    applicaProposte.mockResolvedValue({ agganciati: 1, errori: 0 });
    const res = await tryMatchCrmContact('c1');
    expect(calcolaProposte).toHaveBeenCalledWith({ companyId: 'c1' });
    expect(res).toEqual({ matched: true, contactId: 'x1', via: 'tel+indirizzo' });
  });

  it('nessuna proposta → matched false, nessuna scrittura', async () => {
    calcolaProposte.mockResolvedValue([]);
    expect(await tryMatchCrmContact('c1')).toEqual({ matched: false });
    expect(applicaProposte).not.toHaveBeenCalled();
  });

  it('proposta non applicata (contatto preso nel frattempo) → matched false', async () => {
    calcolaProposte.mockResolvedValue([PROPOSTA]);
    applicaProposte.mockResolvedValue({ agganciati: 0, errori: 0 });
    expect(await tryMatchCrmContact('c1')).toEqual({ matched: false });
  });

  it('best-effort: un errore non risale alla registrazione', async () => {
    calcolaProposte.mockRejectedValue(new Error('db giù'));
    expect(await tryMatchCrmContact('c1')).toEqual({ matched: false });
  });

  // Anche la registrazione è un canale automatico: nessuno guarda
  // un'anteprima prima che scriva, e l'aggancio non si può disfare. Le
  // proposte ambigue restano alla pagina admin, come per il cron.
  it('non applica le proposte ambigue', async () => {
    calcolaProposte.mockResolvedValue([{ ...PROPOSTA, ambigua: true }]);
    expect(await tryMatchCrmContact('c1')).toEqual({ matched: false });
    expect(applicaProposte).not.toHaveBeenCalled();
  });

  it('con una ambigua e una no, applica solo la non ambigua', async () => {
    applicaProposte.mockResolvedValue({ agganciati: 1, saltati: 0, errori: 0 });
    calcolaProposte.mockResolvedValue([
      { ...PROPOSTA, contactId: 'amb', ambigua: true },
      { ...PROPOSTA, contactId: 'ok' },
    ]);
    const res = await tryMatchCrmContact('c1');
    expect(applicaProposte).toHaveBeenCalledWith([
      expect.objectContaining({ contactId: 'ok' }),
    ]);
    expect(res).toEqual({ matched: true, contactId: 'ok', via: 'tel+indirizzo' });
  });
});
