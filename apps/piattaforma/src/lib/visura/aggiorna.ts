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
import { companyMatches, normalizePiva } from '@/lib/kyc/match';
import { extractVisura, type VisuraData } from '@/lib/kyc/visura-parser';
import { isVisuraScaduta, VISURA_VALIDITA_GIORNI } from './validita';

export type SedeLegaleInput = {
  indirizzo: string;
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
 *     `companyMatches` da solo ha semantica OR (P.IVA O denominazione) ed è
 *     l'UNICO controllo d'identità rimasto qui (niente cross-match CI/CF,
 *     vedi sotto): un omonimo normalizzato — `normalizeCompanyName` toglie
 *     forma giuridica E TUTTE LE CIFRE, quindi "Rossi Auto 2000 S.r.l." ≡
 *     "Rossi Auto S.r.l." — potrebbe superarlo via denominazione con la
 *     P.IVA di un estraneo. Si chiude il buco pretendendo ANCHE che la P.IVA
 *     dell'azienda compaia nel testo grezzo della visura (2b).
 *  2b. P.IVA nel testo grezzo — vedi sopra. Sicuro in entrambe le direzioni:
 *     la visura di un estraneo non contiene la nostra P.IVA (rifiuta
 *     l'omonimo), la nostra visura la contiene SEMPRE (nessun falso rifiuto),
 *     indipendentemente da quale run di 11 cifre `PIVA_RE` abbia pescato come
 *     `visura.partitaIva` — in una fixture reale è il CF di una società
 *     socia, non la P.IVA dell'azienda in visura. Per questo NON si confronta
 *     `visura.partitaIva` con quello dell'azienda (rifiuterebbe visure
 *     legittime), si cerca la P.IVA nel testo intero.
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

  // 2b. La P.IVA dell'azienda deve comparire DA QUALCHE PARTE nel testo
  // grezzo (vedi commento sopra la funzione). Si normalizzano TUTTE le cifre
  // del testo intero (non un singolo campo estratto) e si cerca la sequenza:
  // il testo unpdf può avere la P.IVA formattata con spazi/punti
  // ("12.345.678.901") e non è in ordine visivo, quindi isolare "il" campo
  // P.IVA non è affidabile — cercarla ovunque nel documento sì. `rawText`
  // vuoto/assente non è un caso reale (`extractVisura` lo popola sempre), ma
  // il verso giusto su un gate è fail-closed: rifiuta, non passare.
  const rawDigits = visura.rawText ? normalizePiva(visura.rawText) : '';
  if (!rawDigits || !rawDigits.includes(normalizePiva(company.partitaIva))) {
    return {
      ok: false,
      error: 'La visura caricata non risulta intestata alla tua azienda (la partita IVA non compare nel documento).',
    };
  }

  // 3. Deve essere fresca, altrimenti non sbloccherebbe niente.
  const dataEmissioneIso = visura.dataEmissione;
  const dataEmissione = new Date(`${dataEmissioneIso}T00:00:00Z`);
  // `new Date` non valida il calendario: '2026-17-35' → Invalid Date (che il
  // gate età leggerebbe come "mai scaduta": NaN >= 180 è false → fail-open);
  // '2026-02-31' → rollover silenzioso a '2026-03-03' (data valida ma diversa
  // da quella sul documento, verrebbe scritta su Company). Il round-trip
  // verso ISO è la verifica: se non torna la stringa di partenza, la data non
  // è calendariale → stesso ramo/messaggio della leggibilità (fail-closed).
  if (Number.isNaN(dataEmissione.getTime()) || dataEmissione.toISOString().slice(0, 10) !== dataEmissioneIso) {
    return {
      ok: false,
      error: 'Non siamo riusciti a leggere la visura: carica il PDF originale (non una scansione).',
    };
  }
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
        // `indirizzo` è l'unico di questi campi che raggiunge la fattura
        // (`snapshotCompany`, `lib/fatturazione/pv-emittente.ts`): lo si scrive
        // COL numero civico dentro, com'è il testo che dà il parser (vedi
        // `mapSedeLegale` in `app/visura/client.tsx`). Niente campo `civico`
        // separato: nessun consumer lo legge (non esiste `NumeroCivico` nello
        // XML FatturaPA), quindi è solo attrito nell'unica via d'uscita da un
        // blocco operativo — chiavi OMESSE, non azzerate.
        indirizzo: input.sedeLegale.indirizzo,
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
