import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Presidio sui DUE write path di CrmContact (create manuale e bulk import
 * CSV): entrambi DEVONO scrivere le colonne normalizzate via `crmNormFields`,
 * altrimenti la query indicizzata del dedup e il motore di riconciliazione
 * (Task 4+) smettono silenziosamente di trovare corrispondenze.
 *
 * Un test che leggesse il sorgente e contasse le occorrenze testuali di
 * `crmNormFields(` passerebbe anche se la chiamata scrivesse dati sbagliati,
 * se il risultato venisse scartato, o se le due occorrenze fossero nello
 * stesso punto (es. duplicata in un commento). Qui invece si invocano le
 * action vere con Prisma mockato e si legge l'oggetto `data` realmente
 * passato a `create`: è il comportamento a essere sotto test, non il testo.
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
import { createCrmContactAction, bulkImportCrmContactsAction } from './actions';

const authMock = vi.mocked(auth);

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({
    user: { id: 'admin-1', role: 'ADMIN_PIATTAFORMA' },
  } as never);
});

describe('write path CRM: colonne normalizzate', () => {
  it('createCrmContactAction scrive telNorm/emailNorm/waNorm/pivaNorm coerenti con crmNormFields', async () => {
    crmContactMock.findFirst.mockResolvedValue(null); // nessun duplicato
    crmContactMock.create.mockResolvedValue({ id: 'new-id' });

    const result = await createCrmContactAction({
      nome: 'Agenzia Corsico Pratiche Auto',
      cat: 'AGENZIA',
      tel: '+39 02 447 8712',
      wa: '+39 346 287 7310',
      email: ' Test@Esempio.IT ',
      piva: 'IT 06199680155',
      status: 'S0',
      fonte: 'CSV_INIZIALE',
    });

    expect(result.ok).toBe(true);
    expect(crmContactMock.create).toHaveBeenCalledTimes(1);
    const data = crmContactMock.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      telNorm: '024478712',
      waNorm: '3462877310',
      emailNorm: 'test@esempio.it',
      pivaNorm: '06199680155',
    });

    // Anche l'anti-duplicato deve interrogare le colonne normalizzate, non i
    // campi grezzi (altrimenti la query indicizzata non è mai indicizzata).
    const where = crmContactMock.findFirst.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { emailNorm: 'test@esempio.it' },
        { telNorm: '024478712' },
      ]),
    );
  });

  it('bulkImportCrmContactsAction scrive le colonne normalizzate per ogni riga importata', async () => {
    crmContactMock.findMany.mockResolvedValue([]); // nessun contatto esistente
    crmContactMock.create.mockResolvedValue({ id: 'new-id' });

    const csv = [
      'Nome,Telefono,Email',
      'Agenzia Corsico Pratiche Auto,+39 02 447 8712,Test@Esempio.IT',
    ].join('\n');

    const result = await bulkImportCrmContactsAction(csv, 'AGENZIA');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(1);
    expect(crmContactMock.create).toHaveBeenCalledTimes(1);
    const data = crmContactMock.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      telNorm: '024478712',
      emailNorm: 'test@esempio.it',
    });
  });
});
