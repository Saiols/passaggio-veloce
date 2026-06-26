import { nameMatches, normalizeCf, companyMatches } from './match';
import { isAtecoAllowed, type AllowedAteco } from './ateco';
import { richiedeCodiceFiscale } from '../documenti/engine';

/**
 * Verifica documentale di una parte (venditore/acquirente): confronta i dati
 * estratti via OCR dai documenti caricati con i dati inseriti a mano. Modulo
 * PURO, usato identico dal wizard (client, feedback immediato) e dalla Server
 * Action (server, autoritativo). Policy **fail-closed**: una parte è valida solo
 * se ogni documento richiesto è presente e ogni verdetto è MATCH.
 */

export type TipoSoggettoParte =
  | 'PRIVATO_ITALIANO_CIE'
  | 'PRIVATO_ITALIANO_CARTACEA'
  | 'STRANIERO_EXTRA_UE'
  | 'AZIENDA'
  | 'OPERATORE_AUTO'
  | null;

export type ParteDati = {
  isPersonaGiuridica: boolean;
  tipoSoggetto: TipoSoggettoParte;
  documentoIdentita?: 'CI' | 'PASSAPORTO' | 'PATENTE';
  nome?: string;
  cognome?: string;
  cf?: string;
  ragioneSociale?: string;
  piva?: string;
};

export type IdentitaEstratta = { nome?: string; cognome?: string; codiceFiscale?: string };
export type VisuraEstratta = {
  denominazione?: string;
  partitaIva?: string;
  dataEmissione?: string; // ISO yyyy-mm-dd
  amministratore?: { nome?: string; cognome?: string; codiceFiscale?: string };
  ateco?: string; // codice primario (display)
  atecoCodes?: string[]; // TUTTI i codici ATECO trovati (gate operatore auto)
};
export type PermessoEstratto = { nome?: string; cognome?: string; scadenza?: string };

export type OcrParte = {
  identita?: IdentitaEstratta;
  visura?: VisuraEstratta;
  permesso?: PermessoEstratto;
  codiceFiscale?: { codiceFiscale?: string };
};

export type Verdetto = 'MATCH' | 'MISMATCH' | 'ILLEGGIBILE' | 'SCADUTO';

export type DocRequisiti = { identita: boolean; visura: boolean; permesso: boolean; codiceFiscale: boolean };

const VISURA_VALIDITA_MESI = 6;

function isPG(p: ParteDati): boolean {
  return (
    p.isPersonaGiuridica ||
    p.tipoSoggetto === 'AZIENDA' ||
    p.tipoSoggetto === 'OPERATORE_AUTO'
  );
}

/** Documenti richiesti per la parte in base al tipo soggetto + documento scelto. */
export function documentiRichiestiParte(p: ParteDati): DocRequisiti {
  const pg = isPG(p);
  // Per la PG il documento d'identità è del legale rappresentante: la sua CI è
  // trattata come CIE (niente CF), ma passaporto/patente richiedono comunque il CF.
  const tipoEffettivo = pg ? 'PRIVATO_ITALIANO_CIE' : (p.tipoSoggetto ?? 'PRIVATO_ITALIANO_CIE');
  return {
    identita: true,
    visura: pg,
    permesso: p.tipoSoggetto === 'STRANIERO_EXTRA_UE',
    codiceFiscale: richiedeCodiceFiscale(tipoEffettivo, p.documentoIdentita ?? 'CI'),
  };
}

function fullName(nome?: string, cognome?: string): string {
  return `${nome ?? ''} ${cognome ?? ''}`.trim();
}

/** True se `dateIso` cade negli ultimi `mesi` rispetto a `now`. */
function entroUltimiMesi(dateIso: string | undefined, mesi: number, now: Date): boolean {
  if (!dateIso) return false;
  const d = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const limite = new Date(now);
  limite.setMonth(limite.getMonth() - mesi);
  return d.getTime() >= limite.getTime();
}

/** True se la data di scadenza è oggi o futura (permesso ancora valido). */
function nonScaduto(dateIso: string | undefined, now: Date): boolean {
  if (!dateIso) return false;
  const d = new Date(`${dateIso}T23:59:59`);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() >= now.getTime();
}

/**
 * Confronta il documento d'identità estratto coi dati anagrafici inseriti.
 * Il CF, quando presente in entrambi, è la chiave forte (univoca).
 */
export function verificaIdentita(
  dati: { nome?: string; cognome?: string; cf?: string },
  e: IdentitaEstratta | undefined,
): Verdetto {
  if (!e || (!e.nome && !e.cognome && !e.codiceFiscale)) return 'ILLEGGIBILE';
  if (dati.cf && e.codiceFiscale) {
    return normalizeCf(dati.cf) === normalizeCf(e.codiceFiscale) ? 'MATCH' : 'MISMATCH';
  }
  const a = fullName(dati.nome, dati.cognome);
  const b = fullName(e.nome, e.cognome);
  if (!a || !b) return 'ILLEGGIBILE';
  return nameMatches(a, b) ? 'MATCH' : 'MISMATCH';
}

/**
 * Verifica la tessera sanitaria / codice fiscale estratta. Presenza + match
 * fail-closed: senza CF estratto → ILLEGGIBILE; se è atteso un CF (persona
 * fisica: CF inserito; rep PG: CF amministratore della visura) il match è
 * vincolante; senza CF atteso bastano presenza + leggibilità.
 */
export function verificaCodiceFiscale(
  expectedCf: string | undefined,
  e: { codiceFiscale?: string } | undefined,
): Verdetto {
  if (!e || !e.codiceFiscale) return 'ILLEGGIBILE';
  if (!expectedCf) return 'MATCH';
  return normalizeCf(expectedCf) === normalizeCf(e.codiceFiscale) ? 'MATCH' : 'MISMATCH';
}

/**
 * Confronta la visura estratta con l'azienda inserita. La freschezza ≤6 mesi
 * (`requireFreshness`, default true) si applica solo ai commercianti d'auto:
 * per le altre società la data non viene controllata (vedi validaParte).
 */
export function verificaVisura(
  p: ParteDati,
  e: VisuraEstratta | undefined,
  now: Date,
  opts?: { requireFreshness?: boolean },
): Verdetto {
  if (!e || (!e.denominazione && !e.partitaIva)) return 'ILLEGGIBILE';
  const ok = companyMatches(
    { denominazione: e.denominazione, partitaIva: e.partitaIva },
    { denominazione: p.ragioneSociale ?? '', partitaIva: p.piva ?? '' },
  );
  if (!ok) return 'MISMATCH';
  if (opts?.requireFreshness ?? true) {
    if (!e.dataEmissione) return 'ILLEGGIBILE';
    if (!entroUltimiMesi(e.dataEmissione, VISURA_VALIDITA_MESI, now)) return 'SCADUTO';
  }
  return 'MATCH';
}

/** Confronta il permesso estratto con la persona inserita + scadenza valida. */
export function verificaPermesso(
  p: ParteDati,
  e: PermessoEstratto | undefined,
  now: Date,
): Verdetto {
  if (!e || (!e.nome && !e.cognome)) return 'ILLEGGIBILE';
  const a = fullName(p.nome, p.cognome);
  const b = fullName(e.nome, e.cognome);
  if (!a || !b) return 'ILLEGGIBILE';
  if (!nameMatches(a, b)) return 'MISMATCH';
  if (!e.scadenza) return 'ILLEGGIBILE';
  if (!nonScaduto(e.scadenza, now)) return 'SCADUTO';
  return 'MATCH';
}

function messaggio(label: string, v: Verdetto): string {
  switch (v) {
    case 'MISMATCH':
      return `${label}: non corrisponde ai dati inseriti`;
    case 'SCADUTO':
      return `${label}: scaduto o non più valido`;
    default:
      return `${label}: documento mancante o non leggibile, ricaricalo`;
  }
}

/**
 * Validazione complessiva fail-closed della parte. `ok` solo se tutti i
 * documenti richiesti sono presenti e con verdetto MATCH.
 *
 * Persona giuridica (azienda/operatore): la corrispondenza primaria è
 * Visura↔azienda; il documento d'identità è quello del legale rappresentante e
 * viene confrontato con l'amministratore della visura SOLO se estraibile
 * (i dati inseriti per la PG non contengono un nome persona).
 */
/**
 * Opzioni di validazione. `atecoAllowed` (allowlist DEALER) abilita il gate
 * ATECO sull'acquirente operatore auto della minivoltura: si passa solo per
 * quella parte; le altre non vengono mai controllate sull'ATECO.
 */
export type ValidaParteOpts = {
  /** Allowlist ATECO commercianti auto: passata per ogni società. Determina se
   *  la visura è di un commerciante d'auto (→ freschezza ≤6 mesi richiesta). */
  atecoAllowed?: AllowedAteco[];
  /** True SOLO per l'acquirente minivoltura: deve essere commerciante d'auto
   *  (blocco se l'ATECO non lo conferma) e la freschezza è sempre richiesta. */
  richiedeOperatoreAuto?: boolean;
};

export function validaParte(
  p: ParteDati,
  ocr: OcrParte,
  now: Date,
  opts?: ValidaParteOpts,
): { ok: boolean; problemi: string[] } {
  const req = documentiRichiestiParte(p);
  const problemi: string[] = [];
  const push = (label: string, v: Verdetto) => {
    if (v !== 'MATCH') problemi.push(messaggio(label, v));
  };

  if (req.visura) {
    const codici = ocr.visura?.atecoCodes ?? [];
    // Commerciante d'auto = almeno un codice ATECO della visura è nell'allowlist
    // DEALER. Determina la freschezza richiesta (e, per la minivoltura, il blocco).
    const isCommerciante =
      !!opts?.atecoAllowed &&
      codici.some((c) => isAtecoAllowed(c, 'DEALER', opts.atecoAllowed!));
    // Freschezza ≤6 mesi solo per i commercianti d'auto; l'acquirente minivoltura
    // (richiedeOperatoreAuto) è commerciante per definizione → sempre richiesta.
    const requireFreshness = isCommerciante || !!opts?.richiedeOperatoreAuto;
    push('Visura camerale', verificaVisura(p, ocr.visura, now, { requireFreshness }));

    // Gate ATECO: l'acquirente minivoltura DEVE essere commerciante d'auto.
    // Match per prefisso sull'allowlist DEALER. Se la visura espone codici e
    // nessuno è ammesso → blocco; senza codici non blocchiamo (come in
    // registrazione). Gli OPERATORE_AUTO non-minivoltura (es. venditore) non
    // vengono bloccati: per loro l'ATECO serve solo a decidere la freschezza.
    if (opts?.richiedeOperatoreAuto && opts.atecoAllowed && codici.length > 0 && !isCommerciante) {
      problemi.push(
        `Il codice ATECO (${codici.join(', ')}) non rientra tra le attività ammesse per i commercianti auto.`,
      );
    }
    // CI del legale rappresentante: dev'essere presente e leggibile; se la
    // visura espone un amministratore, dev'essere coerente.
    if (!ocr.identita || (!ocr.identita.nome && !ocr.identita.cognome && !ocr.identita.codiceFiscale)) {
      problemi.push(messaggio("Documento d'identità del rappresentante", 'ILLEGGIBILE'));
    } else {
      const rep = ocr.visura?.amministratore;
      if (rep && (rep.nome || rep.cognome || rep.codiceFiscale)) {
        const v = verificaIdentita(
          { nome: rep.nome, cognome: rep.cognome, cf: rep.codiceFiscale },
          ocr.identita,
        );
        if (v === 'MISMATCH') {
          problemi.push("Documento d'identità: non corrisponde al legale rappresentante della visura");
        }
      }
    }
    if (req.codiceFiscale) {
      push(
        'Tessera sanitaria / Codice fiscale',
        verificaCodiceFiscale(ocr.visura?.amministratore?.codiceFiscale, ocr.codiceFiscale),
      );
    }
  } else {
    push("Documento d'identità", verificaIdentita(p, ocr.identita));
    if (req.codiceFiscale) {
      push('Tessera sanitaria / Codice fiscale', verificaCodiceFiscale(p.cf, ocr.codiceFiscale));
    }
  }

  if (req.permesso) push('Permesso di soggiorno', verificaPermesso(p, ocr.permesso, now));

  return { ok: problemi.length === 0, problemi };
}
