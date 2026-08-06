import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/auth', () => ({
  auth: () => Promise.resolve({ user: { id: 'u1', role: 'ADMIN_PIATTAFORMA' } }),
}));
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('redirect'); } }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const findUnique = vi.fn();
const update = vi.fn();
vi.mock('@pv/db', () => ({
  Prisma: {},
  prisma: {
    crmContact: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

import { updateCrmContactAction } from './actions';

/**
 * Regressione del lost update: la scheda contatto poteva riscrivere i campi
 * del funnel con lo snapshot che aveva all'apertura, cancellando un'apertura
 * del link avvenuta nel frattempo. Se qualcuno rimette i campi tracking nel
 * form, questo test torna rosso.
 */
describe('updateCrmContactAction — i campi tracking non sono scrivibili', () => {
  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
    findUnique.mockResolvedValue({ assignedToId: null, status: 'S4', arricchitoDa: null });
    update.mockResolvedValue({});
  });

  // fonte deve essere un valore valido dell'enum (CSV_INIZIALE, non 'CSV'):
  // altrimenti la validazione Zod fallisce prima di arrivare al lost update e
  // il test fallirebbe per il motivo sbagliato.
  const base = {
    nome: 'Autofficina Rossi',
    cat: 'BROKER',
    tel: '3331234567',
    status: 'S4',
    fonte: 'CSV_INIZIALE',
  };

  const CAMPI_TRACKING = [
    'linkInviato', 'linkInviatoAt', 'linkAperto', 'linkAperture',
    'videoInviato', 'videoMin', 'mailAperta', 'smsInviato', 'waInviato',
    'iscrizioneInit', 'iscrizioneComp', 'iscrizioneAt',
  ] as const;

  it('un salvataggio normale non tocca nessun campo tracking', async () => {
    const res = await updateCrmContactAction('c1', base);
    expect(res.ok).toBe(true);
    const data = update.mock.calls[0][0].data;
    for (const campo of CAMPI_TRACKING) {
      expect(data).not.toHaveProperty(campo);
    }
  });

  it('anche se il client li manda a forza, non finiscono sul DB', async () => {
    await updateCrmContactAction('c1', {
      ...base,
      linkAperto: false,
      linkAperture: 0,
      iscrizioneComp: false,
      mailAperta: false,
    });
    const data = update.mock.calls[0][0].data;
    for (const campo of CAMPI_TRACKING) {
      expect(data).not.toHaveProperty(campo);
    }
  });
});
