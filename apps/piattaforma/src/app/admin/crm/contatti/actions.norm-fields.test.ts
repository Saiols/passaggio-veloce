import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Presidio sui TRE write path di CrmContact (create manuale, update manuale e
 * bulk import CSV): tutti DEVONO scrivere le colonne normalizzate via
 * `crmNormFields`, altrimenti la query indicizzata del dedup e il motore di
 * riconciliazione (Task 4+) smettono silenziosamente di trovare
 * corrispondenze.
 *
 * `updateCrmContactAction` oggi è corretto solo perché `dataFromInputForUpdate`
 * fa lo spread di `dataFromInput` (che include `crmNormFields`) — non ha una
 * chiamata propria. È esattamente il punto in cui, in questo repo, un
 * consumer ha già fatto sparire in silenzio un campo enumerando le chiavi a
 * mano invece di riusare la fonte unica: il test qui sotto non presidia "una
 * riga di codice specifica", presidia il comportamento a runtime, quindi
 * regge anche se l'implementazione cambiasse forma.
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
import {
  createCrmContactAction,
  bulkImportCrmContactsAction,
  updateCrmContactAction,
} from './actions';

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

  it('updateCrmContactAction scrive telNorm/emailNorm/waNorm/pivaNorm coerenti con crmNormFields', async () => {
    crmContactMock.update.mockResolvedValue({ id: 'existing-id' });

    const result = await updateCrmContactAction('existing-id', {
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
    expect(crmContactMock.update).toHaveBeenCalledTimes(1);
    const call = crmContactMock.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'existing-id' });
    expect(call.data).toMatchObject({
      telNorm: '024478712',
      waNorm: '3462877310',
      emailNorm: 'test@esempio.it',
      pivaNorm: '06199680155',
    });
  });

  it('una modifica a mano toglie dall audit il campo riscritto', async () => {
    // Il contatto ha ereditato email e città dall'iscrizione; il venditore
    // riscrive l'email a mano. Da quel momento l'email NON viene più
    // dall'iscrizione, e il pannello non deve più dirlo.
    crmContactMock.findUnique.mockResolvedValue({
      assignedToId: null,
      email: 'info@agenziacorsico.it', wa: null, piva: null,
      indirizzo: null, citta: 'Corsico', cap: null, regione: null,
      arricchitoDa: 'email,citta',
    });
    crmContactMock.update.mockResolvedValue({ id: 'existing-id' });

    await updateCrmContactAction('existing-id', {
      nome: 'Agenzia Corsico Pratiche Auto',
      cat: 'AGENZIA',
      tel: '+39 02 447 8712',
      email: 'commerciale@agenziacorsico.it',
      citta: 'Corsico',
      status: 'S0',
      fonte: 'CSV_INIZIALE',
    });

    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.arricchitoDa).toBe('citta');
    // resta ancora qualcosa di ereditato: la data non si azzera
    expect(data.arricchitoAt).toBeUndefined();
  });

  it('riscrivere l ultimo campo ereditato azzera audit e data', async () => {
    crmContactMock.findUnique.mockResolvedValue({
      assignedToId: null,
      email: 'info@agenziacorsico.it', wa: null, piva: null,
      indirizzo: null, citta: null, cap: null, regione: null,
      arricchitoDa: 'email',
    });
    crmContactMock.update.mockResolvedValue({ id: 'existing-id' });

    await updateCrmContactAction('existing-id', {
      nome: 'Agenzia Corsico Pratiche Auto',
      cat: 'AGENZIA',
      tel: '+39 02 447 8712',
      email: 'commerciale@agenziacorsico.it',
      status: 'S0',
      fonte: 'CSV_INIZIALE',
    });

    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.arricchitoDa).toBeNull();
    expect(data.arricchitoAt).toBeNull();
  });

  it('salvare senza toccare i campi ereditati non tocca l audit', async () => {
    crmContactMock.findUnique.mockResolvedValue({
      assignedToId: null,
      email: 'info@agenziacorsico.it', wa: null, piva: null,
      indirizzo: null, citta: null, cap: null, regione: null,
      arricchitoDa: 'email',
    });
    crmContactMock.update.mockResolvedValue({ id: 'existing-id' });

    await updateCrmContactAction('existing-id', {
      nome: 'Nome cambiato',
      cat: 'AGENZIA',
      tel: '+39 02 447 8712',
      // stessa email, scritta con case diverso: il write path la abbassa,
      // quindi il valore salvato non cambia e l'audit resta vero.
      email: 'INFO@AgenziaCorsico.it',
      status: 'S0',
      fonte: 'CSV_INIZIALE',
    });

    const data = crmContactMock.update.mock.calls[0][0].data;
    expect(data.arricchitoDa).toBe('email');
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
