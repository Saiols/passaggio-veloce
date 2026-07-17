/**
 * Ciclo di vita della visura camerale: aggiornamento quando un'azienda è
 * SCADUTA (>= 180 giorni, cfr. `lib/visura/validita.ts`).
 *
 * Flusso a DUE PASSI:
 *  1. `verificaVisuraPerAggiornamento` — OCR + controlli, ritorna un'anteprima.
 *     NON scrive nulla: serve a precompilare il form (`/visura`).
 *  2. `aggiornaVisura` — RI-ESEGUE gli stessi controlli (non si fida
 *     dell'anteprima del passo 1, che è client-facing) e scrive.
 *
 * Sicurezza: `aggiornaVisura` non si fida di nulla che arrivi dal client
 * tranne la sede legale (confermata da un umano). `visuraCameraleData` e
 * `ragioneSociale` vengono SEMPRE dalla sua propria estrazione server-side:
 * se la data arrivasse dal form, basterebbe un POST con la data di oggi per
 * sbloccare l'azienda.
 *
 * I controlli sono fattorizzati in `eseguiControlli`, condiviso dai due
 * passi: duplicarli è il modo sicuro per farli divergere e ritrovarsi il
 * passo 2 (quello che scrive) più permissivo del passo 1 (quello che mostra
 * l'anteprima).
 */
import 'server-only';
import { prisma, Prisma, type CompanyType } from '@pv/db';
import { env } from '@/env';
import { getStorage, storageGetBuffer } from '@/lib/providers/storage';
import { isAtecoAllowed, type AllowedAteco } from '@/lib/kyc/ateco';
import { companyMatches } from '@/lib/kyc/match';
import { extractVisura, type VisuraData } from '@/lib/kyc/visura-parser';
import { isVisuraScaduta, VISURA_VALIDITA_GIORNI } from './validita';

export type SedeLegaleInput = {
  indirizzo: string;
  civico: string;
  cap: string;
  citta: string;
  provincia: string;
};

export type DocRef = { key: string; name: string; size: number; type: string };

export type VerificaVisuraInput = {
  companyId: string;
  ref: DocRef;
  now?: Date;
};

export type VerificaVisuraResult =
  | {
      ok: true;
      dataEmissione: string;
      ragioneSociale: string | null;
      sedeLegale: VisuraData['sedeLegale'];
      atecoNonIdoneo: boolean;
    }
  | { ok: false; error: string };

export type AggiornaVisuraInput = {
  companyId: string;
  userId: string;
  ref: DocRef;
  sedeLegale: SedeLegaleInput;
  now?: Date;
};

export type AggiornaVisuraResult =
  | { ok: true; dataEmissione: string; atecoNonIdoneo: boolean }
  | { ok: false; error: string };

export type AggiornaDeps = {
  getVisura: (i: { buffer: Buffer; mimeType: string; originalFilename: string }) => Promise<VisuraData>;
};

const defaultDeps: AggiornaDeps = { getVisura: (i) => extractVisura(i) };

type CompanyPerControlli = { type: CompanyType; ragioneSociale: string; partitaIva: string };

type ControlloResult =
  | { ok: true; dataEmissioneIso: string; dataEmissione: Date; atecoNonIdoneo: boolean }
  | { ok: false; error: string };

/**
 * Controlli, IDENTICI per i due passi, in ordine:
 *  1. Leggibilità — senza dataEmissione, o senza né P.IVA né denominazione.
 *  2. AZIENDA_MISMATCH — dev'essere la visura di QUESTA azienda (le visure
 *     sono documenti pubblici acquistabili, quindi il match è necessario).
 *  3. Età — la nuova visura deve avere giorniTrascorsi < 180, altrimenti non
 *     sbloccherebbe nulla.
 *  4. ATECO non ammesso → NON blocca: si accetta e si segnala
 *     (`atecoNonIdoneo: true`). Bloccare qui creerebbe un vicolo cieco:
 *     un'azienda già bloccata, senza alcun modo di sbloccarsi da sola.
 *
 * NIENTE cross-match CI/CF dell'amministratore: in 180 giorni può essere
 * cambiato legittimamente; rifiutare una visura nuova perché l'admin non è
 * più quello dell'iscrizione sarebbe un falso positivo.
 */
function eseguiControlli(
  company: CompanyPerControlli,
  visura: VisuraData,
  now: Date,
  allowed: AllowedAteco[],
): ControlloResult {
  // 1. Leggibilità.
  if (!visura.dataEmissione || (!visura.partitaIva && !visura.denominazione)) {
    return {
      ok: false,
      error: 'Non siamo riusciti a leggere la visura: carica il PDF originale (non una scansione).',
    };
  }

  // 2. È la visura di QUESTA azienda?
  if (!companyMatches(visura, { denominazione: company.ragioneSociale, partitaIva: company.partitaIva })) {
    return {
      ok: false,
      error: 'I dati della visura non corrispondono alla tua azienda (ragione sociale / P.IVA).',
    };
  }

  // 3. Deve essere fresca, altrimenti non sbloccherebbe niente.
  const dataEmissioneIso = visura.dataEmissione;
  const dataEmissione = new Date(`${dataEmissioneIso}T00:00:00Z`);
  if (isVisuraScaduta(dataEmissione, now)) {
    return {
      ok: false,
      error: `Questa visura è già oltre i ${VISURA_VALIDITA_GIORNI} giorni di validità: caricane una più recente.`,
    };
  }

  // 4. ATECO: segnala, non blocca.
  const codes = visura.atecoCodes ?? (visura.ateco ? [visura.ateco] : []);
  const atecoNonIdoneo = codes.length > 0 && !codes.some((c) => isAtecoAllowed(c, company.type, allowed));

  return { ok: true, dataEmissioneIso, dataEmissione, atecoNonIdoneo };
}

type EstrazioneResult =
  | {
      ok: true;
      company: { id: string } & CompanyPerControlli;
      visura: VisuraData;
      dataEmissione: Date;
      dataEmissioneIso: string;
      atecoNonIdoneo: boolean;
    }
  | { ok: false; error: string };

/**
 * Orchestrazione condivisa dai due passi: azienda → OCR → codici ATECO
 * ammessi → controlli. Un solo posto dove i due passi possono divergere è
 * quello che scrive (`aggiornaVisura`), mai quello che decide.
 */
async function estraiEControlla(
  companyId: string,
  ref: DocRef,
  now: Date,
  deps: AggiornaDeps,
): Promise<EstrazioneResult> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, type: true, ragioneSociale: true, partitaIva: true },
  });
  if (!company) return { ok: false, error: 'Azienda non trovata' };

  let visura: VisuraData;
  try {
    visura = await deps.getVisura({
      buffer: await storageGetBuffer(ref.key),
      mimeType: ref.type,
      originalFilename: ref.name,
    });
  } catch {
    return { ok: false, error: 'Non siamo riusciti a leggere il documento. Riprova tra qualche minuto.' };
  }

  const allowed = await prisma.atecoAllowedCode.findMany({
    where: { companyType: company.type, active: true },
    select: { companyType: true, code: true, active: true },
  });

  const controllo = eseguiControlli(company, visura, now, allowed);
  if (!controllo.ok) return controllo;

  return {
    ok: true,
    company,
    visura,
    dataEmissione: controllo.dataEmissione,
    dataEmissioneIso: controllo.dataEmissioneIso,
    atecoNonIdoneo: controllo.atecoNonIdoneo,
  };
}

/**
 * Passo 1: OCR + controlli, per precompilare il form `/visura`.
 * NON scrive nulla — l'anteprima non è autoritativa: `aggiornaVisura`
 * ri-esegue gli stessi controlli e non si fida di questo risultato.
 */
export async function verificaVisuraPerAggiornamento(
  input: VerificaVisuraInput,
  deps: AggiornaDeps = defaultDeps,
): Promise<VerificaVisuraResult> {
  const now = input.now ?? new Date();
  const r = await estraiEControlla(input.companyId, input.ref, now, deps);
  if (!r.ok) return r;

  return {
    ok: true,
    dataEmissione: r.dataEmissioneIso,
    ragioneSociale: r.visura.denominazione ?? null,
    sedeLegale: r.visura.sedeLegale,
    atecoNonIdoneo: r.atecoNonIdoneo,
  };
}

/**
 * Passo 2: ri-estrae dal documento (non si fida dell'anteprima del passo 1),
 * ri-esegue gli stessi controlli, e scrive.
 */
export async function aggiornaVisura(
  input: AggiornaVisuraInput,
  deps: AggiornaDeps = defaultDeps,
): Promise<AggiornaVisuraResult> {
  const now = input.now ?? new Date();
  const r = await estraiEControlla(input.companyId, input.ref, now, deps);
  if (!r.ok) return r;

  const storageProvider = getStorage().name;
  await prisma.$transaction(async (tx) => {
    await tx.company.update({
      where: { id: r.company.id },
      data: {
        // DAL SERVER, sempre: la data regge l'intero blocco. Se arrivasse dal
        // form, all'utente basterebbe un POST con la data di oggi per sbloccarsi.
        visuraCameraleData: r.dataEmissione,
        ...(r.visura.denominazione ? { ragioneSociale: r.visura.denominazione } : {}),
        // DALL'UTENTE, che l'ha confermata o corretta: l'estrazione della sede
        // legale è best-effort (4+ indirizzi per visura) e non è affidabile
        // abbastanza da scriverla in fattura senza che un umano la guardi.
        indirizzo: input.sedeLegale.indirizzo,
        civico: input.sedeLegale.civico,
        cap: input.sedeLegale.cap,
        citta: input.sedeLegale.citta,
        provincia: input.sedeLegale.provincia,
        // partitaIva e regimeFiscale NON compaiono di proposito: la chiave va
        // OMESSA, non calcolata a null (null AZZEREREBBE il dato).
      },
    });
    // ADD, non replace: lo storico delle visure è un requisito. Le precedenti
    // NON vanno soft-deletate (il cron purge-deleted-documenti le cancellerebbe).
    await tx.documento.create({
      data: {
        tipo: 'VISURA_CAMERALE',
        companyId: r.company.id,
        storageKey: input.ref.key,
        storageProvider,
        mimeType: input.ref.type,
        sizeBytes: input.ref.size,
        originalFilename: input.ref.name,
        uploadedById: input.userId,
        ocrStato: 'SUCCESS',
        ocrProvider: env.OCR_PROVIDER,
        ocrData: r.visura as unknown as Prisma.InputJsonValue,
        ocrAt: new Date(),
        gatingStato: 'PASSED',
      },
    });
  });

  return { ok: true, dataEmissione: r.dataEmissioneIso, atecoNonIdoneo: r.atecoNonIdoneo };
}
