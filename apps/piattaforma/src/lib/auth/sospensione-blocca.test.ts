import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le SETTE server action marcate `BLOCCA` in `permessi/mappa-sospensione.ts`
 * avevano una sola prova, e statica: `mappa-enforcement.test.ts` verifica che la
 * STRINGA `requireOperativita` compaia nel corpo della funzione. Non che l'esito
 * venga consultato, non che la chiamata preceda le mutazioni. E i quattro test
 * che toccano quelle action mockano `requireOperativita` a `{ ok: true }` — la
 * cosa giusta per loro, ma il risultato complessivo era che nessun test aveva
 * mai visto UNA di quelle action rifiutare per sospensione. Fra queste ci sono
 * la firma del mandato di fatturazione e l'identità fiscale dell'azienda.
 *
 * Qui `requireOperativita` è mockato a `{ ok: false }` e per ognuna si asserisce:
 *   (a) l'errore restituito è ERRORE_SOSPENSIONE (non un errore di parsing né di
 *       scope: la sessione è quella di un titolare e gli input sono validi);
 *   (b) NESSUNA scrittura Prisma è partita — `update`, `create`, `updateMany`.
 *
 * La (b) è ciò che il test statico strutturalmente non può fare, e inchioda
 * l'ordine fra guard e mutazione: un guard chiamato DOPO la scrittura
 * restituirebbe comunque il messaggio giusto e passerebbe la (a).
 *
 * L'elenco delle sette non è duplicato a mano: `mappa-sospensione.ts` è la fonte,
 * e il test in coda verifica che questo file le copra tutte — se una nuova action
 * viene classificata BLOCCA senza un caso qui, la suite diventa rossa.
 */

import { ERRORE_SOSPENSIONE } from './sospensione';
import { MAPPA_SOSPENSIONE } from './permessi/mappa-sospensione';

const {
  authMock,
  prismaMock,
  requireOperativitaMock,
  ritentaMock,
  mandateMock,
  emailSendMock,
  storagePutMock,
  pdfMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  requireOperativitaMock: vi.fn(),
  ritentaMock: vi.fn(),
  mandateMock: vi.fn(),
  emailSendMock: vi.fn(),
  storagePutMock: vi.fn(),
  pdfMock: vi.fn(),
  prismaMock: {
    company: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    sede: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    userSede: { findMany: vi.fn() },
    mandatoFatturazione: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@pv/db', () => ({ prisma: prismaMock }));
vi.mock('@/auth', () => ({ auth: authMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  }),
}));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

// È il modulo sotto esame: qui dice sempre «sospeso», ed è l'unica differenza
// rispetto agli altri test di queste stesse action.
vi.mock('@/lib/auth/sospensione-guard', () => ({
  requireOperativita: requireOperativitaMock,
}));

// Effetti collaterali non-Prisma che un guard mancante farebbe partire: il
// bonifico del mandato SEPA, il ritentativo di addebito, l'email con l'OTP, il
// PDF del mandato sullo storage.
vi.mock('@/lib/fee/retry', () => ({ ritentaAddebitiAgenzia: ritentaMock }));
vi.mock('@/lib/providers/payment/stripe-mandate', () => ({
  applySepaMandateToAgency: mandateMock,
}));
vi.mock('@/lib/providers/email', () => ({ getEmail: () => ({ send: emailSendMock }) }));
vi.mock('@/lib/providers/storage', () => ({ getStorage: () => ({ put: storagePutMock }) }));
vi.mock('@/lib/contratti/mandato-pdf', () => ({ buildMandatoFatturazionePdf: pdfMock }));

import { inviaOtpMandatoAction, firmaMandatoAction } from '@/app/wallet/mandato-actions';
import {
  createSedeAction,
  suspendSedeAction,
  reactivateSedeAction,
} from '@/app/sedi/actions';
import { updateCompanyProfileAction } from '@/app/profilo/azienda/actions';
import { aggiornaIbanERitentaAction } from '@/app/blocco-pagamento/actions';

/** IBAN con checksum MOD97 corretto: il rifiuto non deve venire dalla validazione. */
const IBAN_VALIDO = 'IT60X0542811101000000123456';

/**
 * Titolare di un'AGENZIA: una sola sessione soddisfa i gate di scope di tutte
 * e sette (ADMIN_AZIENDA per sedi/profilo, isOwner per il mandato, companyType
 * AGENZIA per il blocco pagamento), così ogni rifiuto viene dal guard e non
 * dallo scope.
 */
function sessioneTitolare() {
  return {
    user: {
      id: 'u1',
      email: 'titolare@agenzia.it',
      role: 'ADMIN_AZIENDA',
      companyType: 'AGENZIA',
      companyId: 'c1',
    },
  };
}

function formSedeValida(): FormData {
  const fd = new FormData();
  fd.set('nome', 'Sede Centro');
  fd.set('indirizzo', 'Via Roma');
  fd.set('civico', '1');
  fd.set('citta', 'Milano');
  fd.set('cap', '20100');
  fd.set('provincia', 'MI');
  fd.set('payoutThresholdEuro', '1000');
  return fd;
}

function formAziendaValida(): FormData {
  const fd = new FormData();
  fd.set('ragioneSociale', 'Agenzia Test SRL');
  fd.set('codiceSdi', '');
  fd.set('pec', 'pec@agenziatest.it');
  fd.set('email', 'info@agenziatest.it');
  fd.set('telefono', '');
  fd.set('indirizzo', 'Via Roma 1');
  fd.set('citta', 'Milano');
  fd.set('cap', '20100');
  fd.set('provincia', 'MI');
  fd.set('iban', IBAN_VALIDO);
  return fd;
}

function formIban(): FormData {
  const fd = new FormData();
  fd.set('iban', IBAN_VALIDO);
  return fd;
}

type Spia = ReturnType<typeof vi.fn>;

/** Ogni `update`/`create`/`updateMany` del mock Prisma, col proprio nome per il messaggio. */
function scritturePrisma(): [string, Spia][] {
  const out: [string, Spia][] = [];
  const modelli = prismaMock as unknown as Record<string, Record<string, Spia>>;
  for (const [modello, metodi] of Object.entries(modelli)) {
    for (const [metodo, spia] of Object.entries(metodi)) {
      if (metodo === 'update' || metodo === 'create' || metodo === 'updateMany') {
        out.push([`prisma.${modello}.${metodo}`, spia]);
      }
    }
  }
  return out;
}

/** (b): nessuna mutazione, né su Prisma né sui provider esterni. */
function nessunaScrittura(): void {
  for (const [nome, spia] of scritturePrisma()) {
    expect(spia, `${nome} chiamato malgrado la sospensione`).not.toHaveBeenCalled();
  }
  expect(mandateMock, 'mandato SEPA riappoggiato malgrado la sospensione').not.toHaveBeenCalled();
  expect(ritentaMock, 'addebito ritentato malgrado la sospensione').not.toHaveBeenCalled();
  expect(emailSendMock, 'email inviata malgrado la sospensione').not.toHaveBeenCalled();
  expect(storagePutMock, 'file scritto malgrado la sospensione').not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOperativitaMock.mockResolvedValue({ ok: false, error: ERRORE_SOSPENSIONE });
  authMock.mockResolvedValue(sessioneTitolare());
  // Ogni lettura risponde con un dato PLAUSIBILE: se il guard sparisse, l'action
  // proseguirebbe fino alla scrittura invece di fermarsi su un "non trovato",
  // ed è quella la differenza che (b) deve poter vedere.
  prismaMock.company.findUnique.mockResolvedValue({
    type: 'AGENZIA',
    ragioneSociale: 'Agenzia Test SRL',
    email: 'info@agenziatest.it',
  });
  prismaMock.sede.findFirst.mockResolvedValue(null);
  prismaMock.sede.findUnique.mockResolvedValue({ companyId: 'c1', suspensionOrigin: null });
  prismaMock.mandatoFatturazione.findUnique.mockResolvedValue(null);
  mandateMock.mockResolvedValue('ACTIVE');
});

/** Le sette action BLOCCA, ognuna invocata come la invoca la UI. */
const CASI: { chiave: string; esegui: () => Promise<{ ok: boolean; error?: string }> }[] = [
  {
    chiave: 'src/app/wallet/mandato-actions.ts:inviaOtpMandatoAction',
    esegui: () => inviaOtpMandatoAction(),
  },
  {
    chiave: 'src/app/wallet/mandato-actions.ts:firmaMandatoAction',
    esegui: () => firmaMandatoAction('123456'),
  },
  {
    chiave: 'src/app/sedi/actions.ts:createSedeAction',
    esegui: () => createSedeAction(formSedeValida()),
  },
  {
    chiave: 'src/app/sedi/actions.ts:suspendSedeAction',
    esegui: () => suspendSedeAction('sede-1'),
  },
  {
    chiave: 'src/app/sedi/actions.ts:reactivateSedeAction',
    esegui: () => reactivateSedeAction('sede-1'),
  },
  {
    chiave: 'src/app/profilo/azienda/actions.ts:updateCompanyProfileAction',
    esegui: () => updateCompanyProfileAction(formAziendaValida()),
  },
  {
    chiave: 'src/app/blocco-pagamento/actions.ts:aggiornaIbanERitentaAction',
    esegui: () => aggiornaIbanERitentaAction(formIban()),
  },
];

describe('action BLOCCA — un account sospeso viene rifiutato e non scrive nulla', () => {
  for (const caso of CASI) {
    it(`${caso.chiave} → ERRORE_SOSPENSIONE, nessuna scrittura`, async () => {
      const res = await caso.esegui();

      expect(res.ok).toBe(false);
      expect(res.error).toBe(ERRORE_SOSPENSIONE);
      nessunaScrittura();
      expect(requireOperativitaMock).toHaveBeenCalled();
    });
  }

  it('operativo → il guard non è più la ragione del rifiuto (il mock non è tautologico)', async () => {
    // Controprova: con `{ ok: true }` almeno una delle sette arriva alla
    // scrittura. Senza questo caso, un `esegui()` che fallisse per un motivo
    // qualsiasi darebbe comunque tutti i test sopra verdi.
    requireOperativitaMock.mockResolvedValue({ ok: true });

    const res = await updateCompanyProfileAction(formAziendaValida());

    expect(res).toEqual({ ok: true });
    expect(prismaMock.company.update).toHaveBeenCalledTimes(1);
  });
});

describe('copertura', () => {
  it('ogni action BLOCCA di MAPPA_SOSPENSIONE ha un caso in questo file', () => {
    const attese: string[] = [];
    for (const [rel, actions] of Object.entries(MAPPA_SOSPENSIONE)) {
      for (const [nome, esito] of Object.entries(actions)) {
        if (esito === 'BLOCCA') attese.push(`${rel}:${nome}`);
      }
    }
    expect(
      CASI.map((c) => c.chiave).sort(),
      'Una action è marcata BLOCCA in mappa-sospensione.ts ma non ha un caso ' +
        'comportamentale qui: il test statico verifica solo che la stringa ' +
        '`requireOperativita` compaia nel corpo, non che rifiuti davvero senza scrivere.',
    ).toEqual(attese.sort());
  });
});
