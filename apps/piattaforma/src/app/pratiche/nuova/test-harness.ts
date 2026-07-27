import { vi } from 'vitest';

/**
 * Harness condiviso tra `actions.submit-distribuzione.test.ts` e
 * `actions.attestazioni.test.ts`: entrambi esercitano l'INTERO
 * `submitNuovaPraticaAction` a valle di un submit valido, quindi hanno
 * bisogno delle stesse fixture (sessione, FormData valida, mock Prisma).
 *
 * Le chiamate `vi.mock(...)` restano nei singoli file di test — Vitest le
 * hoista per-modulo, quindi non sono estraibili qui — ma tutto ciò che NON
 * dipende da quell'hoisting (fixture di sessione, FormData, factory dei mock
 * Prisma) vive in un posto solo: il prossimo campo obbligatorio del wizard si
 * aggiunge una volta, non in due file identici (era già successo con
 * `attestazioneTerziAccettata`).
 *
 * Non è un file di test (nessun `describe`/`it` qui dentro): il nome
 * `test-harness` lo tiene fuori dal match di Vitest
 * (`vitest.config.ts` → `include: ['src/**\/*.test.ts', ...]`).
 */

/**
 * Due client Prisma-mock DISTINTI ma con gli stessi mock per i modelli usati
 * dentro `$transaction` (`pratica`, `veicolo`, `venditore`, `coAcquirente`,
 * `documento`, `atecoAllowedCode`): i test possono asserire su
 * `prismaMock.pratica.create` indipendentemente da chi l'abbia chiamato,
 * `prisma` o `tx`.
 *
 * `brokerDichiarazione.create` è l'ECCEZIONE, apposta: `txMock` e `prismaMock`
 * ne hanno uno ciascuno, NON condiviso. È quello che rende verificabile
 * l'atomicità della scrittura — se il codice di produzione scrivesse su
 * `prisma.brokerDichiarazione` invece che su `tx.brokerDichiarazione` (o la
 * spostasse fuori dalla transazione), lo si vedrebbe: verrebbe chiamato
 * `prismaMock.brokerDichiarazione.create` invece di
 * `txMock.brokerDichiarazione.create`. Con un unico mock condiviso i due
 * scenari sono indistinguibili.
 */
export function createPrismaMock() {
  const modelliCondivisi = {
    pratica: {
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'pratica-1',
        ...data,
      })),
      update: vi.fn(),
    },
    atecoAllowedCode: { findMany: vi.fn(async () => []) },
    veicolo: {
      create: vi.fn(async ({ data }: { data: { ordine: number } }) => ({
        id: `veicolo-${data.ordine}`,
        ...data,
      })),
    },
    documento: { create: vi.fn(async () => ({ id: 'doc-x' })) },
    venditore: {
      create: vi.fn(async ({ data }: { data: { ordine: number } }) => ({
        id: `venditore-${data.ordine}`,
        ...data,
      })),
    },
    coAcquirente: {
      create: vi.fn(async ({ data }: { data: { ordine: number } }) => ({
        id: `coacq-${data.ordine}`,
        ...data,
      })),
    },
  };

  const txMock = {
    ...modelliCondivisi,
    brokerDichiarazione: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data })),
    },
  };

  const prismaMock = {
    ...modelliCondivisi,
    // Non tipizzato con `data` come quello di `txMock`: nessun test legge il
    // payload di QUESTO mock (se lo facesse, sarebbe già la prova che la
    // scrittura è finita nel client sbagliato).
    brokerDichiarazione: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(txMock)),
  };

  return { prismaMock, txMock };
}

export const DEALER = 'dealer-1';
export const SEDE = { id: 'sede-1', nome: 'Sede test', type: 'DEALER' as const, citta: 'Milano' };

export function sessionCtx() {
  return {
    user: { id: 'u1', companyId: DEALER, companyType: 'DEALER', role: 'OPERATORE' },
    companyId: DEALER,
    companyType: 'DEALER' as const,
    isOwner: false,
    accessibleSedi: [SEDE],
    currentSede: { kind: 'ONE' as const, sede: SEDE },
    scopeIds: [SEDE.id],
    membershipRuoli: {},
    permessi: new Set(['pratiche.create']),
    sospensione: { sospeso: false, motivo: null, origine: null },
  };
}

/** File di upload valido (già su Blob): forma attesa dallo slot `blobRefs`. */
export const ref = (key: string) => ({
  key,
  name: `${key}.pdf`,
  size: 1024,
  type: 'application/pdf',
});

/**
 * FormData minima e valida per una pratica SEMPLICE, 1 veicolo, 1 venditore
 * privato italiano (CIE, niente CF/visura/permesso da allegare), acquirente
 * privato italiano. Entrambe le attestazioni accettate con la versione
 * corrente del registro — `overrides` permette di costruire i casi di rifiuto.
 */
export function buildValidFormData(overrides: Record<string, string | undefined> = {}): FormData {
  const fd = new FormData();
  const fields: Record<string, string | undefined> = {
    tipo: 'SEMPLICE',
    numeroVeicoli: '1',
    veicoli: JSON.stringify([
      {
        tipoDocumento: 'LIBRETTO',
        targa: 'AB123CD',
        telaio: 'WBA12345678901234',
        proprietarioAttuale: 'Mario Rossi',
        preImm2015: false,
        flagComodatoDuso: false,
        flagDelegaVendita: false,
        prezzoVenditaCent: 500000,
      },
    ]),
    venditori: JSON.stringify([
      {
        ordine: 1,
        veicoloOrdine: 1,
        isPG: false,
        tipoSoggetto: 'PRIVATO_ITALIANO',
        ciTipo: 'ELETTRONICA',
        nome: 'Mario',
        cognome: 'Rossi',
        cf: 'RSSMRA80A01H501U',
        telefono: '3331234567',
        email: 'venditore@example.com',
        docId: 'CI',
      },
    ]),
    coAcquirenti: '[]',
    acquirenteIsPG: 'false',
    acquirenteTelefono: '3339876543',
    acquirenteEmail: 'acquirente@example.com',
    acquirenteDocumentoIdentita: 'CI',
    acquirenteTipoSoggetto: 'PRIVATO_ITALIANO',
    acquirenteCiTipo: 'ELETTRONICA',
    comune: 'Milano',
    provincia: 'MI',
    lat: '45.4642',
    lng: '9.19',
    dichiarazioneAccettata: 'true',
    attestazioneTerziAccettata: 'true',
    dichiarazionePopupVersion: 'v4.0',
    blobRefs: JSON.stringify({
      LIBRETTO_1_FRONTE: ref('LIBRETTO_1_FRONTE'),
      LIBRETTO_1_RETRO: ref('LIBRETTO_1_RETRO'),
      VEND1_ID_FRONTE: ref('VEND1_ID_FRONTE'),
      VEND1_ID_RETRO: ref('VEND1_ID_RETRO'),
      ACQ_ID_FRONTE: ref('ACQ_ID_FRONTE'),
      ACQ_ID_RETRO: ref('ACQ_ID_RETRO'),
    }),
    ...overrides,
  };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) fd.set(k, v);
  }
  return fd;
}
