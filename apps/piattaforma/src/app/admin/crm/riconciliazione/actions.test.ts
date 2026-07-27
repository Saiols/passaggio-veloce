import { describe, it, expect, vi, beforeEach } from 'vitest';

const auth = vi.fn();
const riconciliaTutto = vi.fn();
const revalidatePath = vi.fn();
vi.mock('@/auth', () => ({ auth: () => auth() }));
vi.mock('@/lib/crm/match/apply', () => ({
  riconciliaTutto: (...a: unknown[]) => riconciliaTutto(...a),
}));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('REDIRECT');
  },
}));

import { applicaRiconciliazioneAction } from './actions';

describe('applicaRiconciliazioneAction', () => {
  beforeEach(() => {
    auth.mockReset();
    riconciliaTutto.mockReset();
    revalidatePath.mockReset();
    riconciliaTutto.mockResolvedValue({
      proposte: 3,
      ambigueSaltate: 0,
      agganciati: 2,
      saltati: 1,
      errori: 0,
    });
  });

  it('applica per ADMIN_PIATTAFORMA e riporta anche le saltate', async () => {
    auth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_PIATTAFORMA' } });
    expect(await applicaRiconciliazioneAction()).toEqual({
      ok: true,
      agganciati: 2,
      saltati: 1,
      errori: 0,
    });
  });

  // Qui, a differenza del cron, c'è una persona che ha appena visto
  // l'anteprima con le ambigue marcate: è la sede dove si decidono.
  it('applica anche le proposte ambigue (canale presidiato da un umano)', async () => {
    auth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_PIATTAFORMA' } });
    await applicaRiconciliazioneAction();
    expect(riconciliaTutto).toHaveBeenCalledWith({ includiAmbigue: true });
  });

  it('invalida le pagine che mostrano dati agganciati dopo il successo', async () => {
    auth.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN_PIATTAFORMA' } });
    await applicaRiconciliazioneAction();
    expect(revalidatePath).toHaveBeenCalledTimes(3);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/crm/riconciliazione');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/crm/contatti');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/crm/dashboard');
  });

  it('rifiuta SALES_MANAGER: è un\'operazione di massa', async () => {
    auth.mockResolvedValue({ user: { id: 'u2', role: 'SALES_MANAGER' } });
    const res = await applicaRiconciliazioneAction();
    expect(res).toMatchObject({ ok: false });
    expect(riconciliaTutto).not.toHaveBeenCalled();
  });

  it('rifiuta SALES', async () => {
    auth.mockResolvedValue({ user: { id: 'u3', role: 'SALES' } });
    expect(await applicaRiconciliazioneAction()).toMatchObject({ ok: false });
    expect(riconciliaTutto).not.toHaveBeenCalled();
  });
});
