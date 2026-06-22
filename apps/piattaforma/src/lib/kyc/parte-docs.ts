import { nameMatches, normalizeCf, companyMatches } from './match';
import { isAtecoAllowed, type AllowedAteco } from './ateco';

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
};

export type Verdetto = 'MATCH' | 'MISMATCH' | 'ILLEGGIBILE' | 'SCADUTO';

export type DocRequisiti = { identita: boolean; visura: boolean; permesso: boolean };

const VISURA_VALIDITA_MESI = 6;

function isPG(p: ParteDati): boolean {
  return (
    p.isPersonaGiuridica ||
    p.tipoSoggetto === 'AZIENDA' ||
    p.tipoSoggetto === 'OPERATORE_AUTO'
  );
}

/** Documenti richiesti per la parte in base al tipo soggetto. */
export function documentiRichiestiParte(p: ParteDati): DocRequisiti {
  return {
    identita: true,
    visura: isPG(p),
    permesso: p.tipoSoggetto === 'STRANIERO_EXTRA_UE',
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

/** Confronta la visura estratta con l'azienda inserita + freschezza ≤6 mesi. */
export function verificaVisura(
  p: ParteDati,
  e: VisuraEstratta | undefined,
  now: Date,
): Verdetto {
  if (!e || (!e.denominazione && !e.partitaIva)) return 'ILLEGGIBILE';
  const ok = companyMatches(
    { denominazione: e.denominazione, partitaIva: e.partitaIva },
    { denominazione: p.ragioneSociale ?? '', partitaIva: p.piva ?? '' },
  );
  if (!ok) return 'MISMATCH';
  if (!e.dataEmissione) return 'ILLEGGIBILE';
  if (!entroUltimiMesi(e.dataEmissione, VISURA_VALIDITA_MESI, now)) return 'SCADUTO';
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
export type ValidaParteOpts = { atecoAllowed?: AllowedAteco[] };

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
    push('Visura camerale', verificaVisura(p, ocr.visura, now));

    // Gate ATECO (minivoltura): l'acquirente operatore auto deve esercitare
    // un'attività ammessa per i commercianti auto (allowlist DEALER). Stesso
    // controllo della registrazione: match per prefisso, passa se ALMENO uno dei
    // codici della visura è ammesso. Se la visura non espone codici ATECO non
    // blocchiamo qui (lo coprono gli altri verdetti visura).
    if (opts?.atecoAllowed && p.tipoSoggetto === 'OPERATORE_AUTO') {
      const codici = ocr.visura?.atecoCodes ?? [];
      if (
        codici.length > 0 &&
        !codici.some((c) => isAtecoAllowed(c, 'DEALER', opts.atecoAllowed!))
      ) {
        problemi.push(
          `Il codice ATECO (${codici.join(', ')}) non rientra tra le attività ammesse per i commercianti auto.`,
        );
      }
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
  } else {
    push("Documento d'identità", verificaIdentita(p, ocr.identita));
  }

  if (req.permesso) push('Permesso di soggiorno', verificaPermesso(p, ocr.permesso, now));

  return { ok: problemi.length === 0, problemi };
}
