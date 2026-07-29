import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Presidio sulle due action che possono aprire e chiudere un richiamo.
 *
 * Il caso che conta di più non è quello felice: è che un salvataggio della
 * scheda su un contatto che NON era in S11 non debba cancellare la data messa
 * a mano nel campo "Prossimo contatto pianificato". È la differenza fra
 * azzerare in base alla transizione e azzerare in base allo stato finale, e
 * nessun typecheck la vede.
 */
const { crmContactMock } = vi.hoisted(() => ({
  crmContactMock: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@pv/db', () => ({
  prisma: { crmContact: crmContactMock },
  Prisma: {},
}));
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }));
vi.mock('@/lib/notifiche', () => ({ sendNotification: vi.fn() }));
vi.mock('@/lib/auth/permissions', () => ({
  canEditCrmContact: () => true,
  canDeleteCrmContact: () => true,
  canBulkImportCrm: () => true,
}));

import { auth } from '@/auth';
import { updateCrmContactAction, updateCrmContactStatusAction } from './actions';

const authMock = vi.mocked(auth);

/** Payload minimo valido per la scheda contatto. */
const BASE = {
  nome: 'Agenzia Corsico Pratiche Auto',
  cat: 'AGENZIA' as const,
  tel: '+39 02 447 8712',
  fonte: 'CSV_INIZIALE' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({
    user: { id: 'admin-1', role: 'ADMIN_PIATTAFORMA' },
  } as never);
  crmContactMock.update.mockResolvedValue({ id: 'x1' });
});

describe('updateCrmContactStatusAction — tendina di riga', () => {
  it('S11 senza giorno viene rifiutato e non scrive niente', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null, status: 'S3' });

    const res = await updateCrmContactStatusAction('x1', 'S11');

    expect(res.ok).toBe(false);
    expect(crmContactMock.update).not.toHaveBeenCalled();
  });

  it('S11 con giorno e fascia scrive stato, giorno e fascia in un colpo solo', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null, status: 'S3' });

    const res = await updateCrmContactStatusAction('x1', 'S11', {
      giorno: '2026-08-04',
      fascia: 'MATTINA',
    });

    expect(res.ok).toBe(true);
    expect(crmContactMock.update).toHaveBeenCalledTimes(1);
    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.status).toBe('S11');
    expect(data.nextContactAt).toEqual(new Date('2026-08-04'));
    expect(data.nextContactFascia).toBe('MATTINA');
  });

  it('fascia vuota significa indifferente, cioè null', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null, status: 'S3' });

    await updateCrmContactStatusAction('x1', 'S11', { giorno: '2026-08-04', fascia: '' });

    expect(crmContactMock.update.mock.calls[0][0].data.nextContactFascia).toBeNull();
  });

  it('uscire da S11 azzera giorno e fascia', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null, status: 'S11' });

    await updateCrmContactStatusAction('x1', 'S3');

    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.status).toBe('S3');
    expect(data.nextContactAt).toBeNull();
    expect(data.nextContactFascia).toBeNull();
  });

  it('un cambio di stato che non parte da S11 non tocca il richiamo', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null, status: 'S3' });

    await updateCrmContactStatusAction('x1', 'S9');

    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.nextContactAt).toBeUndefined();
    expect(data.nextContactFascia).toBeUndefined();
  });

  it('un SALES non tocca i contatti che non sono suoi', async () => {
    authMock.mockResolvedValue({ user: { id: 'sales-1', role: 'SALES' } } as never);
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: 'altro', status: 'S3' });

    const res = await updateCrmContactStatusAction('x1', 'S11', {
      giorno: '2026-08-04',
      fascia: '',
    });

    expect(res.ok).toBe(false);
    expect(crmContactMock.update).not.toHaveBeenCalled();
  });

  it('un SALES riceve lo stesso errore su un id inesistente e su un id di un altro (niente oracolo di enumerazione)', async () => {
    authMock.mockResolvedValue({ user: { id: 'sales-1', role: 'SALES' } } as never);

    crmContactMock.findUnique.mockResolvedValueOnce(null);
    const resInesistente = await updateCrmContactStatusAction('non-esiste', 'S3');

    crmContactMock.findUnique.mockResolvedValueOnce({ assignedToId: 'altro', status: 'S3' });
    const resAltrui = await updateCrmContactStatusAction('x1', 'S3');

    expect(resInesistente.ok).toBe(false);
    expect(resAltrui.ok).toBe(false);
    // Stesso oggetto, non solo stesso `ok`: se i due messaggi differissero un
    // SALES potrebbe distinguere "non esiste" da "è di un altro" a colpi di id.
    expect(resInesistente).toEqual(resAltrui);
    expect(crmContactMock.update).not.toHaveBeenCalled();
  });

  it('un giorno in formato diverso da YYYY-MM-DD viene rifiutato come mancante', async () => {
    crmContactMock.findUnique.mockResolvedValue({ assignedToId: null, status: 'S3' });

    const res = await updateCrmContactStatusAction('x1', 'S11', {
      giorno: '04/08/2026',
      fascia: '',
    });

    expect(res.ok).toBe(false);
    expect(crmContactMock.update).not.toHaveBeenCalled();
  });
});

describe('updateCrmContactAction — scheda contatto', () => {
  it('S11 senza giorno viene rifiutato', async () => {
    crmContactMock.findUnique.mockResolvedValue({
      assignedToId: null, status: 'S3', arricchitoDa: null,
      email: null, wa: null, piva: null, indirizzo: null,
      citta: null, cap: null, regione: null,
    });

    const res = await updateCrmContactAction('x1', {
      ...BASE, status: 'S11', nextContactAt: '',
    });

    expect(res.ok).toBe(false);
    expect(crmContactMock.update).not.toHaveBeenCalled();
  });

  it('salvare un contatto S3 con una data pianificata NON la cancella', async () => {
    crmContactMock.findUnique.mockResolvedValue({
      assignedToId: null, status: 'S3', arricchitoDa: null,
      email: null, wa: null, piva: null, indirizzo: null,
      citta: null, cap: null, regione: null,
    });

    await updateCrmContactAction('x1', {
      ...BASE, status: 'S3', nextContactAt: '2026-08-04',
    });

    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.nextContactAt).toEqual(new Date('2026-08-04'));
  });

  it('portare la scheda da S11 a S3 azzera giorno e fascia anche se il form li manda', async () => {
    crmContactMock.findUnique.mockResolvedValue({
      assignedToId: null, status: 'S11', arricchitoDa: null,
      email: null, wa: null, piva: null, indirizzo: null,
      citta: null, cap: null, regione: null,
    });

    await updateCrmContactAction('x1', {
      ...BASE, status: 'S3',
      nextContactAt: '2026-08-04',
      nextContactFascia: 'MATTINA',
    });

    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.nextContactAt).toBeNull();
    expect(data.nextContactFascia).toBeNull();
  });

  it('salvare restando in S11 aggiorna giorno e fascia dalla scheda', async () => {
    crmContactMock.findUnique.mockResolvedValue({
      assignedToId: null, status: 'S11', arricchitoDa: null,
      email: null, wa: null, piva: null, indirizzo: null,
      citta: null, cap: null, regione: null,
    });

    await updateCrmContactAction('x1', {
      ...BASE, status: 'S11',
      nextContactAt: '2026-08-06',
      nextContactFascia: 'POMERIGGIO',
    });

    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.nextContactAt).toEqual(new Date('2026-08-06'));
    expect(data.nextContactFascia).toBe('POMERIGGIO');
  });
});
