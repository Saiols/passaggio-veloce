'use client';

import { useState, useTransition, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Checkbox, Field, Input, NumberInput, Select, useToast } from '@/components/ui';
import { WizardProgress } from '@/components/wizard-progress';
import { DichiarazionePopup } from '@/components/dichiarazione-popup';
import { RevisioneManualePopup } from '@/components/revisione-manuale-popup';
import { PENALI } from '@/lib/penali/config';
import { docKey } from '@/lib/documenti/richiesti';
import { AddressAutocomplete } from '@/components/address-autocomplete';
import {
  calcolaDocumentiRichiesti,
  type TipoSoggetto,
  type CiTipo,
} from '@/lib/documenti/engine';
import type { LibrettoCircolazioneData } from '@/lib/providers/ocr/types';
import type { SedeRef } from '@/lib/sedi/scope';
import { intestatariPerVeicolo, crossCheckPerVeicolo } from './venditori-per-veicolo';
import { reconcileVenditori } from './venditori-prefill';
import {
  docVeicoloMancante,
  docVeicoloCompleto,
  type TipoDocumentoVeicolo,
} from './veicolo-doc';
import {
  delegatoDocKey,
  procuraDelegaDocKey,
  delegaDocsComplete,
} from './delega-docs';
import { formatIndirizzo } from './acquirente-indirizzo';
import { residenzaOk } from './residenza';
import { DRAFT_KEY, parseDraft, serializeDraft } from './wizard-draft';
import {
  validaParte,
  documentiRichiestiParte,
  type ParteDati,
  type OcrParte,
  type IdentitaEstratta,
  type VisuraEstratta,
  type PermessoEstratto,
} from '@/lib/kyc/parte-docs';
import type { AllowedAteco } from '@/lib/kyc/ateco';
import { uploadToBlob, type BlobRef } from '@/lib/blob/upload-client';
import { UploadCard, type BlobSlot } from './upload-card';
import {
  extractLibrettoAction,
  extractFoglioComplementareAction,
  extractIdentitaAction,
  extractVisuraAction,
  extractPermessoAction,
  extractCodiceFiscaleAction,
  submitNuovaPraticaAction,
} from './actions';

type DocIdTipo = 'CI' | 'PASSAPORTO' | 'PATENTE';

// `BlobSlot` e la `UploadCard` vivono in ./upload-card (modulo presentazionale
// isolato: grafo import auth-free e quindi testabile in unità).

const emptySlot = (): BlobSlot => ({
  ref: null,
  file: null,
  uploading: false,
  progress: 0,
  error: null,
});

/** True se almeno uno slot è in caricamento (gate "Avanti"/submit). */
function slotUploading(s: BlobSlot | undefined): boolean {
  return !!s && s.uploading;
}

/** Documento d'identità di una parte (slot variabili per tipo) → BlobRef. */
type IdentitaFiles = {
  fronte?: BlobSlot;
  retro?: BlobSlot;
  single?: BlobSlot;
  permesso?: BlobSlot;
  /** Visura camerale (solo AZIENDA / OPERATORE_AUTO). */
  visura?: BlobSlot;
  /** Tessera sanitaria / codice fiscale (fronte), quando l'identificazione non è CIE. */
  codiceFiscale?: BlobSlot;
  /** Tessera sanitaria / codice fiscale (retro), raccolto insieme al fronte. */
  codiceFiscaleRetro?: BlobSlot;
};

/**
 * Splitta una stringa "Nome Cognome" in due parti.
 * Per nomi composti (es. "Maria Carla Bianchi") l'ultimo token è cognome.
 * Se la stringa è una sola parola, la usiamo come cognome (caso edge).
 */
/**
 * A7: presenza documento d'identità per parte. Per la CI e la PATENTE servono
 * ENTRAMBE le facciate (fronte+retro) — coerente con la validazione
 * server-side; per il passaporto basta il file singolo. Il permesso è
 * opzionale. "Presente" significa BlobRef caricata (non basta aver scelto il
 * file: serve che l'upload su Blob sia completato).
 */
function identitaPresente(docId: DocIdTipo, files: IdentitaFiles): boolean {
  return docId === 'CI' || docId === 'PATENTE'
    ? !!files.fronte?.ref && !!files.retro?.ref
    : !!files.single?.ref;
}

/** True se un upload identità è ancora in corso (gate). */
function identitaUploading(files: IdentitaFiles): boolean {
  return (
    slotUploading(files.fronte) ||
    slotUploading(files.retro) ||
    slotUploading(files.single) ||
    slotUploading(files.permesso) ||
    slotUploading(files.visura) ||
    slotUploading(files.codiceFiscale) ||
    slotUploading(files.codiceFiscaleRetro)
  );
}

// docKey del Certificato di Proprietà di un veicolo (pre-2015). Stessa chiave
// usata dall'engine/submit (parte VEICOLO, slot DOC__<docKey>).
function cdpDocKey(ordine: number): string {
  return docKey({ tipo: 'CERTIFICATO_PROPRIETA', parte: 'VEICOLO', veicoloOrdine: ordine, motivo: '' });
}

const STEPS = [
  { id: 1, label: 'Tipo & veicoli', title: 'Tipo pratica e veicoli', hint: 'Scegli il tipo di pratica e carica i libretti di circolazione.' },
  { id: 2, label: 'Venditore', title: 'Venditore', hint: 'Dati del venditore e documento d\'identità + eventuali flag speciali.' },
  { id: 3, label: 'Acquirente', title: 'Acquirente', hint: 'Dati dell\'acquirente e documento d\'identità.' },
  { id: 4, label: 'Invio', title: 'Localizzazione e invio', hint: 'Comune di riferimento e riepilogo finale.' },
] as const;

type Tipo = 'SEMPLICE' | 'MINIVOLTURA';

/** Dati di un singolo veicolo nel wizard (libretto + estrazione + correzioni). */
type VeicoloInput = {
  /** Tipo documento di circolazione: libretto standard o foglio complementare. */
  tipoDocumento: TipoDocumentoVeicolo;
  /** BlobRef del fronte libretto caricato su Blob (slot LIBRETTO_<n>_FRONTE al submit). */
  libretto: BlobSlot;
  /** BlobRef del retro libretto caricato su Blob (slot LIBRETTO_<n>_RETRO al submit).
   *  Il retro può portare etichette di trasferimento di proprietà. */
  librettoRetro: BlobSlot;
  /** BlobRef del PDF foglio complementare (slot FOGLIO_COMPLEMENTARE_<n> al submit). */
  foglioComplementare: BlobSlot;
  fileName: string | null;
  fileNameRetro: string | null;
  ocr?: LibrettoCircolazioneData;
  extracting: boolean;
  ocrError: string | null;
  ocrManuale: boolean;
  targa: string;
  telaio: string;
  proprietarioAttuale: string;
  dataImmatricolazione: string;
  preImm2015: boolean;
  flagComodatoDuso: boolean;
  flagDelegaVendita: boolean;
  /** Prezzo di vendita in euro (stringa dell'input number); → cent al submit. */
  prezzoVendita: string;
};

function emptyVeicolo(): VeicoloInput {
  return {
    tipoDocumento: 'LIBRETTO',
    libretto: emptySlot(),
    librettoRetro: emptySlot(),
    foglioComplementare: emptySlot(),
    fileName: null,
    fileNameRetro: null,
    ocr: undefined,
    extracting: false,
    ocrError: null,
    ocrManuale: false,
    targa: '',
    telaio: '',
    proprietarioAttuale: '',
    dataImmatricolazione: '',
    preImm2015: false,
    flagComodatoDuso: false,
    flagDelegaVendita: false,
    prezzoVendita: '',
  };
}

/** Ridimensiona l'array veicoli a `n` elementi (append vuoti / trim dalla coda). */
function resizeVeicoli(prev: VeicoloInput[], n: number): VeicoloInput[] {
  if (n === prev.length) return prev;
  if (n < prev.length) return prev.slice(0, n);
  const next = prev.slice();
  while (next.length < n) next.push(emptyVeicolo());
  return next;
}

type Parte = {
  isPG: boolean;
  /**
   * Schema Documentale v7 (SD-B): tipologia di soggetto, determina i
   * documenti richiesti via engine. Compatibile col vecchio isPG: AZIENDA
   * e OPERATORE_AUTO settano isPG=true automaticamente.
   */
  tipoSoggetto: TipoSoggetto | null;
  /** Variante CI (rilevante solo per privato + documento CI); default elettronica. */
  ciTipo: CiTipo;
  nome: string;
  cognome: string;
  cf: string;
  ragioneSociale: string;
  piva: string;
  telefono: string;
  email: string;
  /**
   * Verifica documentale OCR (fail-closed): risultati grezzi degli OCR sui
   * documenti caricati per la parte, confrontati con i dati inseriti via
   * validaParte (lib/kyc/parte-docs). Re-OCR solo al cambio file; al cambio
   * file lo slot corrispondente viene invalidato (undefined).
   */
  identitaOcr?: IdentitaEstratta;
  visuraOcr?: VisuraEstratta;
  permessoOcr?: PermessoEstratto;
  /** OCR tessera sanitaria / codice fiscale (fail-closed) per validaParte. */
  codiceFiscaleOcr?: { codiceFiscale?: string };
};

const emptyParte = (): Parte => ({
  isPG: false,
  tipoSoggetto: null,
  ciTipo: 'ELETTRONICA',
  nome: '',
  cognome: '',
  cf: '',
  ragioneSociale: '',
  piva: '',
  telefono: '',
  email: '',
  identitaOcr: undefined,
  visuraOcr: undefined,
  permessoOcr: undefined,
  codiceFiscaleOcr: undefined,
});

/**
 * Tipi pratica multi-veicolo (B6): un venditore (co-intestatario) ha gli stessi
 * campi di una Parte + il proprio documento d'identità (tipo + file). Quando il
 * libretto ha più proprietari, si crea un VenditoreInput per ciascuno.
 */
type VenditoreInput = Parte & {
  /** Id stabile per-parte: usato SOLO per targettizzare gli update di stato
   *  (closure async, merge del prefill, rimozione) e come React key — mai reso
   *  nel DOM. Evita che upload/OCR async colpiscano la parte sbagliata dopo un
   *  riordino dell'array (bug #2) e permette il merge non distruttivo (bug #1). */
  id: string;
  docId: DocIdTipo;
  identita: IdentitaFiles;
  veicoloOrdine: number; // veicolo (1..n) a cui appartiene questo venditore
};

// Id stabile per parte (venditore/co-acquirente). Contatore di modulo: gli id
// non finiscono mai nel DOM (solo targeting di stato + React key), quindi non
// c'è rischio di mismatch SSR/hydration.
let partySeq = 0;
const newPartyId = (): string => `party-${(partySeq += 1)}`;

/** True se almeno uno slot identità porta una BlobRef caricata. */
function identitaHasAnyRef(f: IdentitaFiles): boolean {
  return !!(
    f.fronte?.ref ||
    f.retro?.ref ||
    f.single?.ref ||
    f.permesso?.ref ||
    f.visura?.ref ||
    f.codiceFiscale?.ref ||
    f.codiceFiscaleRetro?.ref
  );
}

const emptyVenditore = (veicoloOrdine = 1): VenditoreInput => ({
  ...emptyParte(),
  id: newPartyId(),
  docId: 'CI',
  identita: {},
  veicoloOrdine,
});

/**
 * Co-intestatario acquirente (solo pratiche SEMPLICE): stessi campi del blocco
 * acquirente principale (Parte + documento + residenza), a livello pratica.
 */
type CoAcquirenteInput = Parte & {
  /** Id stabile per-parte (vedi VenditoreInput.id). */
  id: string;
  docId: DocIdTipo;
  identita: IdentitaFiles;
  residenzaDiversa: boolean;
  indirizzoResidenza: string;
};

const emptyCoAcquirente = (): CoAcquirenteInput => ({
  ...emptyParte(),
  id: newPartyId(),
  docId: 'CI',
  identita: {},
  residenzaDiversa: false,
  indirizzoResidenza: '',
});

// --- Persistenza bozza (localStorage) ----------------------------------------
// I File non sono serializzabili: teniamo solo la BlobRef (il file è già su
// Blob, l'OCR è già stato fatto) e azzeriamo i flag transitori. Al refresh lo
// slot torna con ref valida e file null → la UploadCard lo mostra "Caricato".
function slotForStorage(s: BlobSlot): BlobSlot {
  return { ref: s.ref, file: null, uploading: false, progress: 0, error: null };
}

function identitaForStorage(f: IdentitaFiles): IdentitaFiles {
  const out: IdentitaFiles = {};
  if (f.fronte) out.fronte = slotForStorage(f.fronte);
  if (f.retro) out.retro = slotForStorage(f.retro);
  if (f.single) out.single = slotForStorage(f.single);
  if (f.permesso) out.permesso = slotForStorage(f.permesso);
  if (f.visura) out.visura = slotForStorage(f.visura);
  if (f.codiceFiscale) out.codiceFiscale = slotForStorage(f.codiceFiscale);
  if (f.codiceFiscaleRetro) out.codiceFiscaleRetro = slotForStorage(f.codiceFiscaleRetro);
  return out;
}

function veicoloForStorage(v: VeicoloInput): VeicoloInput {
  return {
    ...v,
    libretto: slotForStorage(v.libretto),
    librettoRetro: slotForStorage(v.librettoRetro),
    foglioComplementare: slotForStorage(v.foglioComplementare),
    extracting: false,
    ocrError: null,
  };
}

/** Firma degli intestatari (deve coincidere con l'effect di prefill venditori). */
function computeOwnersSig(veicoli: VeicoloInput[]): string {
  return intestatariPerVeicolo(veicoli)
    .map((o) => `${o.veicoloOrdine}#${o.display}`)
    .join('|');
}

/** Forma serializzabile dello stato del wizard salvata come bozza. */
type WizardDraftState = {
  step: number;
  tipo: Tipo;
  multiplo: boolean;
  numeroVeicoli: number;
  veicoli: VeicoloInput[];
  venditori: VenditoreInput[];
  coAcquirenti: CoAcquirenteInput[];
  acquirente: Parte;
  acquirenteDocId: DocIdTipo;
  acquirenteIdentita: IdentitaFiles;
  acquirenteResidenzaDiversa: boolean;
  acquirenteIndirizzoResidenza: string;
  brokerSedeId: string;
  comune: string;
  provincia: string;
  documenti: Record<string, BlobSlot>;
};

const TIPI_SOGGETTO_VENDITORE: { value: TipoSoggetto; label: string }[] = [
  { value: 'PRIVATO_ITALIANO', label: 'Privato italiano' },
  { value: 'STRANIERO_EXTRA_UE', label: 'Straniero extra-UE' },
  { value: 'AZIENDA', label: 'Azienda / Società' },
  { value: 'OPERATORE_AUTO', label: 'Operatore auto / Commerciante' },
];

/** Variante della carta d'identità (mostrata solo per privato + documento CI). */
const CI_TIPO_OPTIONS: { value: CiTipo; label: string }[] = [
  { value: 'ELETTRONICA', label: 'CI elettronica (CIE)' },
  { value: 'CARTACEA', label: 'CI cartacea' },
];

// Acquirente SEMPLICE: privato (no operatore auto). Acquirente MINIVOLTURA: il
// compratore è un commerciante d'auto → solo OPERATORE_AUTO (con visura).
const TIPI_SOGGETTO_ACQUIRENTE_SEMPLICE: { value: TipoSoggetto; label: string }[] =
  TIPI_SOGGETTO_VENDITORE.filter((t) => t.value !== 'OPERATORE_AUTO');

const TIPI_SOGGETTO_ACQUIRENTE_MINIVOLTURA: { value: TipoSoggetto; label: string }[] = [
  { value: 'OPERATORE_AUTO', label: 'Operatore auto / Commerciante' },
];

/** Card selezionabile per il tipo pratica (4 combinazioni tipo × multiplo). */
const TIPO_CARDS: {
  key: string;
  tipo: Tipo;
  multiplo: boolean;
  label: string;
  descrizione: string;
}[] = [
  {
    key: 'SEMPLICE_SINGOLO',
    tipo: 'SEMPLICE',
    multiplo: false,
    label: 'Passaggio di proprietà semplice',
    descrizione: "chi acquista è un privato o un'azienda che NON commercia auto",
  },
  {
    key: 'SEMPLICE_MULTIPLO',
    tipo: 'SEMPLICE',
    multiplo: true,
    label: 'Passaggio di proprietà semplice multiplo',
    descrizione: "chi acquista è un privato o un'azienda che NON commercia auto",
  },
  {
    key: 'MINIVOLTURA_SINGOLA',
    tipo: 'MINIVOLTURA',
    multiplo: false,
    label: 'Minivoltura singola',
    descrizione: "chi acquista è un commerciante d'auto",
  },
  {
    key: 'MINIVOLTURA_MULTIPLA',
    tipo: 'MINIVOLTURA',
    multiplo: true,
    label: 'Minivoltura multipla',
    descrizione: "chi acquista è un commerciante d'auto",
  },
];

export function WizardNuovaPratica({
  error,
  atecoAllowed,
  sedi,
  defaultSedeId,
  userId,
}: {
  error?: string;
  /** Allowlist ATECO DEALER (admin /admin/ateco): gate operatore auto minivoltura. */
  atecoAllowed: AllowedAteco[];
  /** Sedi del dealer; il selettore "Sede di partenza" appare solo con più d'una. */
  sedi: SedeRef[];
  /** Sede pre-selezionata (sede operativa corrente, o la prima accessibile). */
  defaultSedeId?: string;
  /** Utente loggato: la bozza è scoping PER-UTENTE (vedi draftKey). */
  userId: string;
}) {
  const [step, setStep] = useState(1);
  // Multi-sede: sede broker da cui parte la pratica (selettore in step 4).
  const multiSede = sedi.length > 1;
  const [brokerSedeId, setBrokerSedeId] = useState(defaultSedeId ?? '');

  // Chiave bozza PER-UTENTE: la chiave fissa condivisa (DRAFT_KEY) faceva
  // trapelare la bozza (targhe, venditori, acquirente, brokerSedeId) tra utenti
  // diversi sullo STESSO browser → invii con una sede non accessibile e perdita
  // di isolamento multi-tenant. Con lo userId nella chiave ogni utente ha la sua.
  const draftKey = `${DRAFT_KEY}:${userId}`;

  // Al cambio step riporta la pagina in cima: gli step sono lunghi (upload +
  // OCR + verifiche) e l'utente deve ripartire dall'inizio della sezione.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);
  const [tipo, setTipo] = useState<Tipo>('SEMPLICE');
  const [multiplo, setMultiplo] = useState(false);
  const [numeroVeicoli, setNumeroVeicoli] = useState<number>(1);
  const [veicoli, setVeicoli] = useState<VeicoloInput[]>([emptyVeicolo()]);

  // Aggiorna numeroVeicoli + ridimensiona l'array veicoli insieme (evita un
  // effect: il set è guidato dalle interazioni utente, non da uno stato esterno).
  const changeNumeroVeicoli = (n: number) => {
    const clamped = Math.min(50, Math.max(1, n));
    setNumeroVeicoli(clamped);
    setVeicoli((prev) => resizeVeicoli(prev, clamped));
    // Pota i venditori dei veicoli rimossi (bug #5/#10): senza questo restano
    // orfani nello stato (invisibili e non rimovibili nell'accordion) e vengono
    // inviati con un veicoloOrdine inesistente → Venditore con veicoloId=null
    // lato server, scollegato da ogni veicolo e col cross-check saltato.
    setVenditori((prev) => {
      const kept = prev.filter((v) => v.veicoloOrdine <= clamped);
      return kept.length ? kept : [emptyVenditore(1)];
    });
  };

  const handleCardSelect = (card: (typeof TIPO_CARDS)[number]) => {
    setTipo(card.tipo);
    setMultiplo(card.multiplo);
    // Resetta il numero veicoli SOLO quando cambia davvero la dimensione
    // singolo/multiplo (bug #11): passare tra due card multiplo o ri-cliccare la
    // stessa card non deve riportare a 2 scartando i veicoli 3..N già caricati.
    if (card.multiplo !== multiplo) changeNumeroVeicoli(card.multiplo ? 2 : 1);
    // Se il nuovo tipo non è MINIVOLTURA, l'acquirente deve poter scegliere un
    // tipo soggetto valido per SEMPLICE; resettiamo se era OPERATORE_AUTO.
    if (card.tipo !== 'MINIVOLTURA') {
      setAcquirente((prev) =>
        prev.tipoSoggetto === 'OPERATORE_AUTO'
          ? { ...prev, tipoSoggetto: null, isPG: false, visuraOcr: undefined }
          : prev,
      );
    } else {
      // MINIVOLTURA: acquirente singolo commerciante → via eventuali co-intestatari.
      setCoAcquirenti([]);
      // MINIVOLTURA: l'acquirente è un operatore auto → preimposta.
      setAcquirente((prev) =>
        prev.tipoSoggetto === 'OPERATORE_AUTO'
          ? prev
          : { ...prev, tipoSoggetto: 'OPERATORE_AUTO', isPG: true },
      );
    }
  };

  const updateVeicolo = (idx: number, patch: Partial<VeicoloInput>) => {
    setVeicoli((prev) =>
      prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)),
    );
  };

  // B6: N venditori (co-intestatari). Ciascuno ha gli stessi campi di una Parte
  // + il proprio documento d'identità. Default: un venditore vuoto.
  const [venditori, setVenditori] = useState<VenditoreInput[]>([emptyVenditore()]);
  // Accordion step Venditore (solo multiplo): veicolo aperto (default il primo).
  const [veicoloAperto, setVeicoloAperto] = useState<number>(1);
  // Scroll all'inizio della card del veicolo appena aperto: chiudendosi quella
  // sopra l'altezza della pagina cambia, quindi senza questo si finirebbe a metà.
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const accordionMontato = useRef(false);
  useEffect(() => {
    if (!accordionMontato.current) {
      accordionMontato.current = true;
      return;
    }
    if (veicoloAperto > 0) {
      cardRefs.current[veicoloAperto]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [veicoloAperto]);
  const [acquirente, setAcquirente] = useState<Parte>(emptyParte());

  // Aggiorna un singolo venditore per indice (update immutabile).
  // Update/rimozione per ID STABILE (non per indice): le closure catturate da
  // upload/OCR async restano corrette anche se l'array viene riordinato (bug #2).
  const updateVenditore = (id: string, patch: Partial<VenditoreInput>) => {
    setVenditori((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  };
  const addVenditore = (veicoloOrdine = 1) =>
    setVenditori((prev) => [...prev, emptyVenditore(veicoloOrdine)]);
  const removeVenditore = (id: string) =>
    setVenditori((prev) => (prev.length <= 1 ? prev : prev.filter((v) => v.id !== id)));

  // Co-intestatari venditori = 2+ venditori sullo stesso veicolo. Prima
  // dell'invio il broker va avvisato che TUTTI i co-intestatari devono
  // presentarsi fisicamente in agenzia alla firma con i propri documenti.
  const hasCoIntestatariVenditori = useMemo(() => {
    const perVeicolo = new Map<number, number>();
    for (const v of venditori) {
      perVeicolo.set(v.veicoloOrdine, (perVeicolo.get(v.veicoloOrdine) ?? 0) + 1);
    }
    return [...perVeicolo.values()].some((n) => n >= 2);
  }, [venditori]);

  // Documento d'identità per parte (A7): tipo scelto + file caricati. Il file
  // fronte (CI e patente) o il file singolo (passaporto) avvia l'OCR di pre-fill.
  const [acquirenteDocId, setAcquirenteDocId] = useState<DocIdTipo>('CI');
  const [acquirenteIdentita, setAcquirenteIdentita] = useState<IdentitaFiles>({});

  // Residenza acquirente: domanda "uguale al documento?" (default Sì = false) +
  // indirizzo alternativo quando il broker risponde No (stringa formattata).
  const [acquirenteResidenzaDiversa, setAcquirenteResidenzaDiversa] = useState(false);
  const [acquirenteIndirizzoResidenza, setAcquirenteIndirizzoResidenza] = useState('');

  // Co-intestatari acquirente (solo SEMPLICE). Default: nessuno.
  const [coAcquirenti, setCoAcquirenti] = useState<CoAcquirenteInput[]>([]);
  const updateCoAcquirente = (id: string, patch: Partial<CoAcquirenteInput>) =>
    setCoAcquirenti((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const addCoAcquirente = () => setCoAcquirenti((prev) => [...prev, emptyCoAcquirente()]);
  const removeCoAcquirente = (id: string) =>
    setCoAcquirenti((prev) => prev.filter((c) => c.id !== id));

  const [comune, setComune] = useState('');
  const [provincia, setProvincia] = useState('');
  const hasMaps = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  // Step Documenti: BlobRef caricate per documento richiesto (chiave = docKey).
  const [documenti, setDocumenti] = useState<Record<string, BlobSlot>>({});

  const acquirenteTipiSoggetto =
    tipo === 'MINIVOLTURA'
      ? TIPI_SOGGETTO_ACQUIRENTE_MINIVOLTURA
      : TIPI_SOGGETTO_ACQUIRENTE_SEMPLICE;

  // Rigenera i venditori PER VEICOLO: per ogni libretto un venditore per ciascun
  // intestatario (C.2 proprietario + C.3 secondo intestatario/utilizzatore),
  // taggato col veicoloOrdine (no dedup tra veicoli → stesso intestatario su 2
  // veicoli = 2 voci). Si attiva solo quando l'insieme cambia, così non
  // sovrascrive le modifiche fatte a mano nello step Venditore.
  // Stato di hydration della bozza: dichiarato qui perché l'effect di prefill
  // venditori deve attenderlo (vedi sotto).
  const hydratedRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);

  const ownersSig = useRef<string>('');
  useEffect(() => {
    // Aspetta il ripristino della bozza. Senza questa guardia l'effect girerebbe
    // prima sullo stato di default (pre-restore) — resettando ownersSig — e poi
    // sui veicoli ripristinati, rigenerando i venditori dagli intestatari e
    // SOVRASCRIVENDO quelli ripristinati (coi documenti già validati). Dopo
    // l'hydration ownersSig è allineato ai veicoli ripristinati → niente clobber.
    if (!hydrated) return;
    const prefill = intestatariPerVeicolo(veicoli);
    const sig = computeOwnersSig(veicoli);
    if (sig === ownersSig.current) return;
    ownersSig.current = sig;
    if (!prefill.length) return;
    // MERGE non distruttivo (bug #1/#3/#4): riusa i venditori esistenti abbinati
    // per identità (preserva documenti/verdetti/contatti + co-intestatari
    // manuali), semina i vuoti, aggiunge solo gli intestatari realmente nuovi.
    // Non sostituisce più l'intero array (che cancellava i documenti KYC già
    // caricati ad ogni re-upload/re-OCR o aggiunta di un altro veicolo).
    setVenditori((prev) =>
      reconcileVenditori(prev, prefill, {
        makeEmpty: emptyVenditore,
        hasIdentita: (v) => identitaHasAnyRef(v.identita),
      }),
    );
  }, [veicoli, hydrated]);

  // --- Persistenza bozza: ripristino + salvataggio ---------------------------
  // Ripristino PRIMA del paint (niente flash dello stato vuoto). La guardia
  // versione/scadenza e il try/catch sono nel modulo: una bozza corrotta o di
  // vecchio schema viene semplicemente ignorata.
  useLayoutEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    // Cleanup una-tantum della VECCHIA bozza a chiave condivisa (pre-fix): poteva
    // contenere dati di un altro utente loggato in precedenza sullo stesso
    // browser. Ora si legge solo la chiave per-utente, quindi la rimuoviamo.
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    try {
      const d = parseDraft(localStorage.getItem(draftKey), Date.now()) as
        | Partial<WizardDraftState>
        | null;
      if (d) {
        if (typeof d.step === 'number') setStep(d.step);
        if (d.tipo) setTipo(d.tipo);
        if (typeof d.multiplo === 'boolean') setMultiplo(d.multiplo);
        if (typeof d.numeroVeicoli === 'number') setNumeroVeicoli(d.numeroVeicoli);
        if (Array.isArray(d.veicoli)) {
          setVeicoli(d.veicoli);
          // Allinea la firma intestatari: l'effect di prefill venditori vedrà la
          // stessa sig e NON sovrascriverà i venditori ripristinati.
          ownersSig.current = computeOwnersSig(d.veicoli);
        }
        // Backfill dell'id stabile per bozze salvate prima della sua
        // introduzione (altrimenti il targeting per id non troverebbe la parte).
        if (Array.isArray(d.venditori))
          setVenditori(d.venditori.map((v) => (v.id ? v : { ...v, id: newPartyId() })));
        if (Array.isArray(d.coAcquirenti))
          setCoAcquirenti(d.coAcquirenti.map((c) => (c.id ? c : { ...c, id: newPartyId() })));
        if (d.acquirente) setAcquirente(d.acquirente);
        if (d.acquirenteDocId) setAcquirenteDocId(d.acquirenteDocId);
        if (d.acquirenteIdentita) setAcquirenteIdentita(d.acquirenteIdentita);
        if (typeof d.acquirenteResidenzaDiversa === 'boolean')
          setAcquirenteResidenzaDiversa(d.acquirenteResidenzaDiversa);
        if (typeof d.acquirenteIndirizzoResidenza === 'string')
          setAcquirenteIndirizzoResidenza(d.acquirenteIndirizzoResidenza);
        // Difesa in profondità: ripristina la sede SOLO se è ancora tra quelle
        // accessibili (una sede stale/non accessibile farebbe fallire l'invio).
        if (
          typeof d.brokerSedeId === 'string' &&
          d.brokerSedeId &&
          sedi.some((s) => s.id === d.brokerSedeId)
        )
          setBrokerSedeId(d.brokerSedeId);
        if (typeof d.comune === 'string') setComune(d.comune);
        if (typeof d.provincia === 'string') setProvincia(d.provincia);
        if (d.documenti) setDocumenti(d.documenti);
      }
    } catch {
      /* bozza illeggibile: si parte puliti */
    }
    setHydrated(true);
    // Ripristino una-tantum (guardia hydratedRef): draftKey/sedi sono stabili.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Salvataggio debounced (solo dopo il ripristino, così non si sovrascrive la
  // bozza con lo stato iniziale vuoto). I File non si salvano: solo le BlobRef.
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      try {
        const draft: WizardDraftState = {
          step,
          tipo,
          multiplo,
          numeroVeicoli,
          veicoli: veicoli.map(veicoloForStorage),
          venditori: venditori.map((v) => ({ ...v, identita: identitaForStorage(v.identita) })),
          coAcquirenti: coAcquirenti.map((c) => ({
            ...c,
            identita: identitaForStorage(c.identita),
          })),
          acquirente,
          acquirenteDocId,
          acquirenteIdentita: identitaForStorage(acquirenteIdentita),
          acquirenteResidenzaDiversa,
          acquirenteIndirizzoResidenza,
          brokerSedeId,
          comune,
          provincia,
          documenti: Object.fromEntries(
            Object.entries(documenti).map(([k, s]) => [k, slotForStorage(s)]),
          ),
        };
        localStorage.setItem(draftKey, serializeDraft(draft, Date.now()));
      } catch {
        /* quota o serializzazione: la bozza è best-effort */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [
    draftKey,
    hydrated,
    step,
    tipo,
    multiplo,
    numeroVeicoli,
    veicoli,
    venditori,
    coAcquirenti,
    acquirente,
    acquirenteDocId,
    acquirenteIdentita,
    acquirenteResidenzaDiversa,
    acquirenteIndirizzoResidenza,
    brokerSedeId,
    comune,
    provincia,
    documenti,
  ]);

  // Svuota la bozza salvata (al submit riuscito e dal bottone "Ricomincia").
  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
  };

  const ricominciaDaCapo = () => {
    if (
      !confirm(
        'Sicuro di voler ricominciare da capo? I dati inseriti in questa bozza andranno persi.',
      )
    ) {
      return;
    }
    clearDraft();
    window.location.reload();
  };

  const [submitting, startSubmit] = useTransition();
  const router = useRouter();
  const toast = useToast();

  // Sistema Penali Broker — SP-A: popup di responsabilità mostrato come step
  // finale prima del submit. Il broker deve spuntare il checkbox prima di
  // poter cliccare "Conferma e invia". Il backend logga IP+UA+versione popup.
  const [showDichiarazione, setShowDichiarazione] = useState(false);
  const [dichiarazioneAccettata, setDichiarazioneAccettata] = useState(false);

  // Schema Documentale v7 — SD-C: bottone/popup "Non trovo la mia situazione"
  // per richiedere review manuale al team PV (caso non riconosciuto).
  const [showRevisione, setShowRevisione] = useState(false);

  // Schema Documentale v7 (SD-B): preview lista documenti richiesti calcolata
  // tramite engine. Si aggiorna in real-time mentre il broker compila i campi.
  const esitoSchema = useMemo(() => {
    return calcolaDocumentiRichiesti({
      veicoli: veicoli.map((v, i) => ({
        ordine: i + 1,
        preImm2015: v.preImm2015,
        flagComodatoDuso: v.flagComodatoDuso,
      })),
      venditori: venditori.map((v, i) => ({
        ordine: i + 1,
        tipoSoggetto: v.tipoSoggetto,
        documentoIdentita: v.docId,
        ciTipo: v.ciTipo,
      })),
      flagProcura: false,
      flagSuccessione: false,
      acquirenteTipoSoggetto: acquirente.tipoSoggetto,
      acquirenteDocumentoIdentita: acquirenteDocId,
      acquirenteCiTipo: acquirente.ciTipo,
      flagMinore: false,
    });
  }, [
    veicoli,
    venditori,
    acquirente.tipoSoggetto,
    acquirente.ciTipo,
    acquirenteDocId,
  ]);

  // Avvia OCR combinato fronte+retro quando entrambe le BlobRef sono pronte.
  // Viene chiamato dopo ogni upload (fronte o retro); se l'altra ref manca ancora,
  // l'OCR non parte. Invalida l'OCR precedente se uno dei file cambia.
  const runLibrettoOcr = async (idx: number, fronteRef: BlobRef, retroRef: BlobRef) => {
    updateVeicolo(idx, { extracting: true, ocr: undefined, ocrError: null });
    try {
      const res = await extractLibrettoAction(fronteRef, retroRef);
      if (res.ok) {
        // Se l'OCR non estrae NULLA di utile (né targa, né telaio, né
        // intestatari) il documento non è un libretto leggibile/corretto:
        // blocco e richiesta di ricaricare. Niente compilazione manuale: nello
        // ZIP della pratica devono finire i documenti GIUSTI e leggibili.
        const vuota =
          !res.data.targa &&
          !res.data.telaio &&
          !(res.data.proprietari && res.data.proprietari.length > 0);
        if (vuota) {
          updateVeicolo(idx, {
            extracting: false,
            ocr: undefined,
            ocrError:
              'Non sono riuscito a leggere i dati da questo documento. Assicurati di caricare il libretto di circolazione corretto, ben inquadrato e leggibile, e riprova.',
          });
          return;
        }
        updateVeicolo(idx, {
          extracting: false,
          ocrError: null,
          ocr: res.data,
          targa: res.data.targa ?? '',
          telaio: res.data.telaio ?? '',
          proprietarioAttuale: res.data.proprietarioAttuale ?? '',
          dataImmatricolazione: res.data.dataImmatricolazione ?? '',
          preImm2015: res.data.preImm2015,
          flagComodatoDuso: res.data.flagComodatoDuso,
        });
        // I venditori si rigenerano dall'unione degli intestatari via effect.
      } else {
        updateVeicolo(idx, { extracting: false, ocr: undefined, ocrError: res.error });
      }
    } catch (err) {
      updateVeicolo(idx, {
        extracting: false,
        ocrError: (err as Error).message,
      });
    }
  };

  // Upload del fronte libretto su Blob. Dopo l'upload avvia OCR se anche il
  // retro è già pronto; altrimenti aspetta il retro. Invalidando sempre l'OCR
  // al cambio di fronte, si garantisce il re-OCR.
  // I-1: se file=undefined (remove), azzera lo slot e invalida l'OCR.
  const onFronteSelected = async (idx: number, file: File | undefined) => {
    if (!file) {
      // Rimozione: azzera fronte + stato OCR (step-1 gate richiede ref+ocr).
      updateVeicolo(idx, {
        libretto: emptySlot(),
        fileName: null,
        ocr: undefined,
        ocrError: null,
        extracting: false,
      });
      return;
    }
    updateVeicolo(idx, {
      libretto: { ref: null, file, uploading: true, progress: 0, error: null },
      fileName: file.name,
      ocr: undefined,
      ocrError: null,
      ocrManuale: false,
      extracting: false,
    });
    let ref: BlobRef;
    try {
      ref = await uploadToBlob(file, 'pratiche-staging', (pct) => {
        setVeicoli((prev) =>
          prev.map((v, i) =>
            i === idx ? { ...v, libretto: { ...v.libretto, progress: pct } } : v,
          ),
        );
      });
    } catch (err) {
      updateVeicolo(idx, {
        libretto: { ref: null, file, uploading: false, progress: 0, error: (err as Error).message },
      });
      return;
    }
    // I-2: applica il nuovo ref e legge il retro dalla stessa snapshot aggiornata
    // in un'unica functional update, così il check è deterministic (niente race).
    setVeicoli((prev) => {
      const updated = prev.map((v, i) =>
        i === idx ? { ...v, libretto: { ref, file, uploading: false, progress: 100, error: null } } : v,
      );
      const retroRef = updated[idx]?.librettoRetro?.ref;
      if (retroRef) {
        void runLibrettoOcr(idx, ref, retroRef);
      }
      return updated;
    });
  };

  // Upload del retro libretto su Blob. Dopo l'upload avvia OCR se anche il
  // fronte è già pronto; altrimenti aspetta il fronte.
  // I-1: se file=undefined (remove), azzera lo slot e invalida l'OCR.
  const onRetroSelected = async (idx: number, file: File | undefined) => {
    if (!file) {
      // Rimozione: azzera retro + stato OCR (step-1 gate richiede ref+ocr).
      updateVeicolo(idx, {
        librettoRetro: emptySlot(),
        fileNameRetro: null,
        ocr: undefined,
        ocrError: null,
        extracting: false,
      });
      return;
    }
    updateVeicolo(idx, {
      librettoRetro: { ref: null, file, uploading: true, progress: 0, error: null },
      fileNameRetro: file.name,
      ocr: undefined,
      ocrError: null,
      ocrManuale: false,
      extracting: false,
    });
    let ref: BlobRef;
    try {
      ref = await uploadToBlob(file, 'pratiche-staging', (pct) => {
        setVeicoli((prev) =>
          prev.map((v, i) =>
            i === idx ? { ...v, librettoRetro: { ...v.librettoRetro, progress: pct } } : v,
          ),
        );
      });
    } catch (err) {
      updateVeicolo(idx, {
        librettoRetro: { ref: null, file, uploading: false, progress: 0, error: (err as Error).message },
      });
      return;
    }
    // I-2: applica il nuovo ref e legge il fronte dalla stessa snapshot aggiornata
    // in un'unica functional update, così il check è deterministic (niente race).
    setVeicoli((prev) => {
      const updated = prev.map((v, i) =>
        i === idx ? { ...v, librettoRetro: { ref, file, uploading: false, progress: 100, error: null } } : v,
      );
      const fronteRef = updated[idx]?.libretto?.ref;
      if (fronteRef) {
        void runLibrettoOcr(idx, fronteRef, ref);
      }
      return updated;
    });
  };

  // Upload del foglio complementare: PDF o foto (JPG/PNG), entrambi dallo scanner
  // (ritaglio/migliora, come il libretto). Dopo l'upload, OCR best-effort (parser
  // dedicato): pre-compila targa/telaio quando riesce; se fallisce, i campi
  // restano da inserire a mano (niente blocco). Il "Proprietario attuale" resta
  // manuale (non lo estraiamo qui). La data di immatricolazione NON è sul foglio
  // → resta sempre manuale.
  const onFoglioSelected = async (idx: number, file: File | undefined) => {
    if (!file) {
      updateVeicolo(idx, {
        foglioComplementare: emptySlot(),
        ocr: undefined,
        ocrError: null,
        extracting: false,
      });
      return;
    }
    updateVeicolo(idx, {
      foglioComplementare: { ref: null, file, uploading: true, progress: 0, error: null },
      ocr: undefined,
      ocrError: null,
      extracting: false,
    });
    let ref: BlobRef;
    try {
      ref = await uploadToBlob(file, 'pratiche-staging', (pct) => {
        setVeicoli((prev) =>
          prev.map((v, i) =>
            i === idx
              ? { ...v, foglioComplementare: { ...v.foglioComplementare, progress: pct } }
              : v,
          ),
        );
      });
    } catch (err) {
      updateVeicolo(idx, {
        foglioComplementare: {
          ref: null,
          file,
          uploading: false,
          progress: 0,
          error: (err as Error).message,
        },
      });
      return;
    }
    updateVeicolo(idx, {
      foglioComplementare: { ref, file, uploading: false, progress: 100, error: null },
      extracting: true,
    });
    // OCR best-effort: i campi appaiono comunque (mostraCampi = PDF caricato).
    try {
      const res = await extractFoglioComplementareAction(ref);
      if (res.ok) {
        const d = res.data;
        const patch: Partial<VeicoloInput> = {
          extracting: false,
          ocrError: null,
          ocr: d,
          preImm2015: d.preImm2015,
        };
        if (d.targa) patch.targa = d.targa;
        if (d.telaio) patch.telaio = d.telaio;
        // NB: né il "Proprietario attuale" né la ragione sociale del venditore si
        // pre-compilano dal foglio (scelta di prodotto: l'OCR del foglio non è
        // affidabile sull'intestatario) — il broker li inserisce a mano. Il parser
        // non emette proprietari/proprietariInfo, quindi prefill e cross-check
        // restano no-op per il foglio; il venditore resta comunque obbligatorio.
        updateVeicolo(idx, patch);
      } else {
        updateVeicolo(idx, { extracting: false, ocr: undefined, ocrError: null });
      }
    } catch {
      updateVeicolo(idx, { extracting: false, ocr: undefined, ocrError: null });
    }
  };

  // Cambio tipo documento del veicolo: azzera il ramo non più pertinente (slot +
  // OCR) così il submit non trascina file orfani e il gate resta coerente.
  const onTipoDocumentoSelected = (idx: number, t: TipoDocumentoVeicolo) => {
    if (t === 'FOGLIO_COMPLEMENTARE') {
      updateVeicolo(idx, {
        tipoDocumento: t,
        libretto: emptySlot(),
        librettoRetro: emptySlot(),
        fileName: null,
        fileNameRetro: null,
        ocr: undefined,
        ocrError: null,
        extracting: false,
      });
    } else {
      updateVeicolo(idx, { tipoDocumento: t, foglioComplementare: emptySlot() });
    }
  };

  // A7: OCR del documento d'identità → pre-fill nome/cognome/CF della parte +
  // salvataggio del risultato grezzo (`identitaOcr`) per la verifica documentale
  // (validaParte). Chiamato quando la BlobRef del file principale (fronte CI o
  // single) è pronta. Non sovrascrive i campi già compilati a mano dal broker.
  const runIdentitaOcr = async <P extends Parte>(
    ref: BlobRef,
    tipo: DocIdTipo,
    onChange: (updater: (p: P) => P) => void,
  ) => {
    try {
      const res = await extractIdentitaAction(ref, tipo);
      if (!res.ok) return;
      const { nome, cognome, codiceFiscale } = res.data;
      const identitaOcr: IdentitaEstratta = {
        nome,
        cognome,
        codiceFiscale,
      };
      onChange((prev) => {
        // Persona giuridica: il documento è del legale rappresentante → non
        // pre-fillare i campi azienda, ma conserva l'OCR per il verdetto.
        if (prev.isPG) return { ...prev, identitaOcr };
        return {
          ...prev,
          identitaOcr,
          nome: prev.nome.trim() ? prev.nome : nome ?? prev.nome,
          cognome: prev.cognome.trim() ? prev.cognome : cognome ?? prev.cognome,
          cf: prev.cf.trim() ? prev.cf : (codiceFiscale ?? prev.cf).toUpperCase(),
        };
      });
    } catch {
      // best-effort: il broker può sempre compilare a mano
    }
  };

  // Verifica documentale — OCR visura camerale (AZIENDA / OPERATORE_AUTO).
  // Salva il risultato grezzo (`visuraOcr`) per validaParte (cross-check
  // denominazione/P.IVA + freschezza ≤6 mesi). Re-OCR solo al cambio file.
  const runVisuraOcr = async <P extends Parte>(
    ref: BlobRef,
    onChange: (updater: (p: P) => P) => void,
  ) => {
    try {
      const res = await extractVisuraAction(ref);
      if (!res.ok) return;
      onChange((prev) => ({ ...prev, visuraOcr: res.data }));
    } catch {
      // best-effort: il verdetto resterà ILLEGGIBILE finché non si ricarica
    }
  };

  // Verifica documentale — OCR permesso di soggiorno (STRANIERO_EXTRA_UE).
  // Salva il risultato grezzo (`permessoOcr`) per validaParte (cross-check
  // nominativo + scadenza valida). Re-OCR solo al cambio file.
  const runPermessoOcr = async <P extends Parte>(
    ref: BlobRef,
    onChange: (updater: (p: P) => P) => void,
  ) => {
    try {
      const res = await extractPermessoAction(ref);
      if (!res.ok) return;
      onChange((prev) => ({ ...prev, permessoOcr: res.data }));
    } catch {
      // best-effort: il verdetto resterà ILLEGGIBILE finché non si ricarica
    }
  };

  // Verifica documentale — OCR tessera sanitaria / codice fiscale. Salva il
  // risultato grezzo (`codiceFiscaleOcr`) per validaParte. Re-OCR solo al cambio file.
  const runCfOcr = async <P extends Parte>(
    ref: BlobRef,
    onChange: (updater: (p: P) => P) => void,
  ) => {
    try {
      const res = await extractCodiceFiscaleAction(ref);
      if (!res.ok) return;
      onChange((prev) => ({ ...prev, codiceFiscaleOcr: { codiceFiscale: res.data.codiceFiscale } }));
    } catch {
      // best-effort: il verdetto resterà ILLEGGIBILE finché non si ricarica
    }
  };

  // Bug #9: ri-arma gli OCR interrotti da un refresh durante la finestra di
  // estrazione (o rimasti a vuoto dopo un OCR fallito). Alla riapertura della
  // bozza i file sono già su Blob (ref presente) ma il risultato OCR manca → i
  // campi del veicolo restano nascosti e i gate step 1/2/3 restano bloccati senza
  // rimedio se non ricaricare il file. One-shot dopo l'hydration.
  const reOcrArmedRef = useRef(false);
  useEffect(() => {
    if (!hydrated || reOcrArmedRef.current) return;
    reOcrArmedRef.current = true;

    // Libretti: fronte+retro presenti ma OCR mancante → ri-estrai (sblocca step 1).
    veicoli.forEach((v, i) => {
      if (
        v.tipoDocumento === 'LIBRETTO' &&
        v.libretto.ref &&
        v.librettoRetro.ref &&
        !v.ocr &&
        !v.extracting
      ) {
        void runLibrettoOcr(i, v.libretto.ref, v.librettoRetro.ref);
      }
    });

    // Ri-arma gli OCR documentali di una parte quando il file è presente ma il
    // relativo verdetto OCR manca (sblocca la verifica fail-closed step 2/3).
    const rearmParte = <P extends Parte & { docId: DocIdTipo; identita: IdentitaFiles }>(
      p: P,
      docId: DocIdTipo,
      identita: IdentitaFiles,
      onChange: (updater: (prev: P) => P) => void,
    ) => {
      const mainRef =
        docId === 'CI' || docId === 'PATENTE' ? identita.fronte?.ref : identita.single?.ref;
      if (mainRef && !p.identitaOcr) void runIdentitaOcr<P>(mainRef, docId, onChange);
      if (identita.visura?.ref && !p.visuraOcr) void runVisuraOcr<P>(identita.visura.ref, onChange);
      if (identita.permesso?.ref && !p.permessoOcr)
        void runPermessoOcr<P>(identita.permesso.ref, onChange);
      if (identita.codiceFiscale?.ref && !p.codiceFiscaleOcr)
        void runCfOcr<P>(identita.codiceFiscale.ref, onChange);
    };

    venditori.forEach((v) =>
      rearmParte(v, v.docId, v.identita, (upd) =>
        setVenditori((prev) => prev.map((vv) => (vv.id === v.id ? upd(vv) : vv))),
      ),
    );
    coAcquirenti.forEach((c) =>
      rearmParte(c, c.docId, c.identita, (upd) =>
        setCoAcquirenti((prev) => prev.map((cc) => (cc.id === c.id ? upd(cc) : cc))),
      ),
    );
    // Acquirente: identità/visura/permesso/CF in acquirenteIdentita + acquirente.
    {
      const mainRef =
        acquirenteDocId === 'CI' || acquirenteDocId === 'PATENTE'
          ? acquirenteIdentita.fronte?.ref
          : acquirenteIdentita.single?.ref;
      if (mainRef && !acquirente.identitaOcr)
        void runIdentitaOcr<Parte>(mainRef, acquirenteDocId, setAcquirente);
      if (acquirenteIdentita.visura?.ref && !acquirente.visuraOcr)
        void runVisuraOcr<Parte>(acquirenteIdentita.visura.ref, setAcquirente);
      if (acquirenteIdentita.permesso?.ref && !acquirente.permessoOcr)
        void runPermessoOcr<Parte>(acquirenteIdentita.permesso.ref, setAcquirente);
      if (acquirenteIdentita.codiceFiscale?.ref && !acquirente.codiceFiscaleOcr)
        void runCfOcr<Parte>(acquirenteIdentita.codiceFiscale.ref, setAcquirente);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const handleFinalSubmit = () => {
    // Tutti i libretti (fronte e retro) devono avere la BlobRef pronta.
    if (veicoli.some((v) => !v.libretto.ref || !v.librettoRetro.ref)) return;
    const fd = new FormData();
    fd.append('tipo', tipo);
    fd.append('numeroVeicoli', String(numeroVeicoli));

    // Mappa slot → BlobRef: i file sono già su Blob (client upload), alla
    // Server Action passa SOLO le chiavi (BlobRef) in un unico campo JSON.
    const blobRefs: Record<string, BlobRef> = {};

    // Lista veicoli (JSON). I libretti vanno negli slot LIBRETTO_1..LIBRETTO_n.
    const veicoliPayload = veicoli.map((v) => ({
      tipoDocumento: v.tipoDocumento,
      targa: v.targa,
      telaio: v.telaio,
      proprietarioAttuale: v.proprietarioAttuale,
      dataImmatricolazione: v.dataImmatricolazione || null,
      preImm2015: v.preImm2015,
      flagComodatoDuso: v.flagComodatoDuso,
      flagDelegaVendita: v.flagDelegaVendita,
      prezzoVenditaCent: Math.round(Number(v.prezzoVendita) * 100),
      // OCR grezzo (libretto o foglio complementare), pre-correzione.
      ocrData: v.ocr ?? null,
    }));
    fd.append('veicoli', JSON.stringify(veicoliPayload));
    veicoli.forEach((v, i) => {
      if (v.tipoDocumento === 'FOGLIO_COMPLEMENTARE') {
        if (v.foglioComplementare.ref)
          blobRefs[`FOGLIO_COMPLEMENTARE_${i + 1}`] = v.foglioComplementare.ref;
        return;
      }
      if (v.libretto.ref) blobRefs[`LIBRETTO_${i + 1}_FRONTE`] = v.libretto.ref;
      if (v.librettoRetro.ref) blobRefs[`LIBRETTO_${i + 1}_RETRO`] = v.librettoRetro.ref;
    });

    // ocrManuale: true se almeno un veicolo è stato compilato a mano.
    fd.append(
      'ocrManuale',
      veicoli.some((v) => v.ocrManuale) ? 'true' : 'false',
    );

    // B6: N venditori (co-intestatari) come JSON. Ordine = indice + 1. Include
    // tutti i campi parte + docId per ciascuno; i file identità vanno negli slot
    // VEND<n>_* (BlobRef) qui sotto.
    const venditoriPayload = venditori.map((v, i) => ({
      ordine: i + 1,
      veicoloOrdine: v.veicoloOrdine,
      isPG: v.isPG,
      tipoSoggetto: v.tipoSoggetto,
      ciTipo: v.ciTipo,
      nome: v.nome,
      cognome: v.cognome,
      cf: v.cf,
      ragioneSociale: v.ragioneSociale,
      piva: v.piva,
      telefono: v.telefono,
      email: v.email,
      docId: v.docId,
    }));
    fd.append('venditori', JSON.stringify(venditoriPayload));

    fd.append('acquirenteIsPG', acquirente.isPG ? 'true' : 'false');
    if (acquirente.isPG) {
      fd.append('acquirenteRagioneSociale', acquirente.ragioneSociale);
      fd.append('acquirentePIVA', acquirente.piva);
    } else {
      fd.append('acquirenteNome', acquirente.nome);
      fd.append('acquirenteCognome', acquirente.cognome);
      fd.append('acquirenteCF', acquirente.cf);
    }
    fd.append('acquirenteTelefono', acquirente.telefono);
    fd.append('acquirenteEmail', acquirente.email);
    if (acquirenteResidenzaDiversa && acquirenteIndirizzoResidenza.trim()) {
      fd.append('acquirenteIndirizzoResidenza', acquirenteIndirizzoResidenza.trim());
    }

    // Documenti richiesti (step Documenti) come slot DOC__<docKey> (BlobRef).
    // Eccezione: i due allegati delega/procura usano la propria chiave DELEGA_*
    // (non passano per l'engine documenti richiesti).
    for (const [key, slot] of Object.entries(documenti)) {
      if (!slot.ref) continue;
      blobRefs[key.startsWith('DELEGA_') ? key : `DOC__${key}`] = slot.ref;
    }

    // Schema Documentale v7 (SD-B): tipo soggetto acquirente.
    // (Per i venditori questo campo è nel JSON `venditori` qui sopra. Le date
    // validità visura/permesso non si passano più: la validità è verificata
    // via OCR nella verifica documentale, vedi lib/kyc/parte-docs.)
    if (acquirente.tipoSoggetto) {
      fd.append('acquirenteTipoSoggetto', acquirente.tipoSoggetto);
      fd.append('acquirenteCiTipo', acquirente.ciTipo);
    }

    // B6: documento d'identità + visura + permesso PER venditore negli slot
    // VEND<n>_* (BlobRef). Il tipo documento (docId) viaggia nel JSON `venditori`.
    venditori.forEach((v, i) => {
      const n = i + 1;
      if (v.docId === 'CI' || v.docId === 'PATENTE') {
        if (v.identita.fronte?.ref) blobRefs[`VEND${n}_ID_FRONTE`] = v.identita.fronte.ref;
        if (v.identita.retro?.ref) blobRefs[`VEND${n}_ID_RETRO`] = v.identita.retro.ref;
      } else if (v.identita.single?.ref) {
        blobRefs[`VEND${n}_ID`] = v.identita.single.ref;
      }
      if (v.identita.permesso?.ref) blobRefs[`VEND${n}_PERMESSO`] = v.identita.permesso.ref;
      if (v.identita.visura?.ref) blobRefs[`VEND${n}_VISURA`] = v.identita.visura.ref;
      if (v.identita.codiceFiscale?.ref) blobRefs[`VEND${n}_CF`] = v.identita.codiceFiscale.ref;
      if (v.identita.codiceFiscaleRetro?.ref)
        blobRefs[`VEND${n}_CF_RETRO`] = v.identita.codiceFiscaleRetro.ref;
    });

    // A7: documento d'identità + visura + permesso acquirente (tipo + slot BlobRef).
    fd.append('acquirenteDocumentoIdentita', acquirenteDocId);
    if (acquirenteDocId === 'CI' || acquirenteDocId === 'PATENTE') {
      if (acquirenteIdentita.fronte?.ref) blobRefs['ACQ_ID_FRONTE'] = acquirenteIdentita.fronte.ref;
      if (acquirenteIdentita.retro?.ref) blobRefs['ACQ_ID_RETRO'] = acquirenteIdentita.retro.ref;
    } else if (acquirenteIdentita.single?.ref) {
      blobRefs['ACQ_ID'] = acquirenteIdentita.single.ref;
    }
    if (acquirenteIdentita.permesso?.ref) blobRefs['ACQ_PERMESSO'] = acquirenteIdentita.permesso.ref;
    if (acquirenteIdentita.visura?.ref) blobRefs['ACQ_VISURA'] = acquirenteIdentita.visura.ref;
    if (acquirenteIdentita.codiceFiscale?.ref) blobRefs['ACQ_CF'] = acquirenteIdentita.codiceFiscale.ref;
    if (acquirenteIdentita.codiceFiscaleRetro?.ref)
      blobRefs['ACQ_CF_RETRO'] = acquirenteIdentita.codiceFiscaleRetro.ref;

    // Co-intestatari acquirente (solo SEMPLICE): JSON + slot COACQ<n>_*.
    const coAcquirentiPayload = coAcquirenti.map((c, i) => ({
      ordine: i + 1,
      isPG: c.isPG,
      nome: c.nome,
      cognome: c.cognome,
      cf: c.cf,
      ragioneSociale: c.ragioneSociale,
      piva: c.piva,
      telefono: c.telefono,
      email: c.email,
      tipoSoggetto: c.tipoSoggetto,
      ciTipo: c.ciTipo,
      docId: c.docId,
      indirizzoResidenza: c.residenzaDiversa ? c.indirizzoResidenza.trim() : null,
    }));
    fd.append('coAcquirenti', JSON.stringify(coAcquirentiPayload));

    coAcquirenti.forEach((c, i) => {
      const n = i + 1;
      if (c.docId === 'CI' || c.docId === 'PATENTE') {
        if (c.identita.fronte?.ref) blobRefs[`COACQ${n}_ID_FRONTE`] = c.identita.fronte.ref;
        if (c.identita.retro?.ref) blobRefs[`COACQ${n}_ID_RETRO`] = c.identita.retro.ref;
      } else if (c.identita.single?.ref) {
        blobRefs[`COACQ${n}_ID`] = c.identita.single.ref;
      }
      if (c.identita.permesso?.ref) blobRefs[`COACQ${n}_PERMESSO`] = c.identita.permesso.ref;
      if (c.identita.visura?.ref) blobRefs[`COACQ${n}_VISURA`] = c.identita.visura.ref;
      if (c.identita.codiceFiscale?.ref) blobRefs[`COACQ${n}_CF`] = c.identita.codiceFiscale.ref;
      if (c.identita.codiceFiscaleRetro?.ref)
        blobRefs[`COACQ${n}_CF_RETRO`] = c.identita.codiceFiscaleRetro.ref;
    });

    // Unico campo FormData con la mappa slot → BlobRef (niente File nel body).
    fd.append('blobRefs', JSON.stringify(blobRefs));

    fd.append('comune', comune);
    fd.append('provincia', provincia);

    // Multi-sede: sede broker di partenza (il server la valida e ricade sulla
    // sede operativa se vuota). Inviata solo se selezionabile.
    if (brokerSedeId) fd.append('brokerSedeId', brokerSedeId);

    // Sistema Penali Broker: payload di accettazione popup (versione + flag)
    fd.append('dichiarazioneAccettata', 'true');
    fd.append('dichiarazionePopupVersion', PENALI.POPUP_VERSION);

    startSubmit(async () => {
      const res = await submitNuovaPraticaAction(fd);
      if (res?.ok) {
        clearDraft(); // pratica creata: la bozza non serve più
        router.push(`/pratiche/${res.id}`);
      }
    });
  };

  const current = STEPS.find((s) => s.id === step)!;

  // Tutti i veicoli devono avere ENTRAMBI fronte e retro caricati (BlobRef) +
  // campi obbligatori (targa/telaio/proprietario/data) prima di proseguire.
  // Nessun upload del libretto deve essere ancora in corso.
  const librettiUploading = veicoli.some(
    (v) => v.libretto.uploading || v.librettoRetro.uploading || v.foglioComplementare.uploading,
  );
  const veicoliValidi =
    veicoli.length === numeroVeicoli &&
    veicoli.every(
      (v) =>
        // Documento di circolazione completo: libretto fronte+retro+OCR, oppure
        // foglio complementare (solo PDF, niente OCR).
        docVeicoloCompleto({
          tipoDocumento: v.tipoDocumento,
          librettoFronte: !!v.libretto.ref,
          librettoRetro: !!v.librettoRetro.ref,
          ocr: !!v.ocr,
          foglio: !!v.foglioComplementare.ref,
        }) &&
        v.targa.length >= 5 &&
        v.telaio.length >= 11 &&
        v.proprietarioAttuale.length > 0 &&
        /^\d{4}-\d{2}-\d{2}$/.test(v.dataImmatricolazione) &&
        Number(v.prezzoVendita) > 0,
    );
  // Gate per lasciare lo step 1 (Tipo & veicoli).
  // Veicoli pre-2015: il Certificato di Proprietà va caricato qui (step veicolo).
  const cdpUploading = veicoli.some((v, i) => v.preImm2015 && documenti[cdpDocKey(i + 1)]?.uploading);
  const cdpMancante = veicoli.some((v, i) => v.preImm2015 && !documenti[cdpDocKey(i + 1)]?.ref);
  const canStep1 =
    veicoliValidi && !librettiUploading && !cdpUploading && !cdpMancante;

  // Cross-check insiemistico venditori ↔ intestatari PER VEICOLO: i venditori del
  // veicolo i devono coincidere con gli intestatari del libretto i (C.2 + C.3),
  // con fallback al proprietarioAttuale editabile.
  const proprietariPerVeicolo: Record<number, string[]> = {};
  veicoli.forEach((v, i) => {
    proprietariPerVeicolo[i + 1] =
      v.tipoDocumento === 'FOGLIO_COMPLEMENTARE'
        ? v.ocr?.proprietari ?? [] // foglio: cross-check solo se l'OCR ha letto l'intestatario
        : v.ocr?.proprietari ?? (v.proprietarioAttuale ? [v.proprietarioAttuale] : []);
  });
  const venditoriCC = venditori.map((v) => ({
    veicoloOrdine: v.veicoloOrdine,
    isPG: v.isPG,
    nome: v.nome,
    cognome: v.cognome,
    ragioneSociale: v.ragioneSociale,
  }));
  const ccVend = crossCheckPerVeicolo(venditoriCC, proprietariPerVeicolo);
  // Esito per singolo veicolo (per mostrare l'alert nell'accordion giusto).
  const ccPerVeicolo: Record<number, 'OK' | 'MISMATCH' | 'SCONOSCIUTO'> = {};
  veicoli.forEach((_, i) => {
    const ord = i + 1;
    ccPerVeicolo[ord] = crossCheckPerVeicolo(
      venditoriCC.filter((v) => v.veicoloOrdine === ord),
      { [ord]: proprietariPerVeicolo[ord] ?? [] },
    );
  });

  // Verifica documentale OCR (fail-closed): verdetto per ogni venditore e per
  // l'acquirente, calcolato dai campi inseriti + OCR salvati. `now` unico per
  // tutta la render così i verdetti sono coerenti tra gate e Alert.
  const now = new Date();
  // L'allowlist ATECO è passata a tutte le società (serve a decidere la
  // freschezza ≤6 mesi della visura: solo per i commercianti d'auto). Il blocco
  // "deve essere commerciante" (richiedeOperatoreAuto) resta solo per
  // l'acquirente della minivoltura.
  const verdettiVenditori = venditori.map((v) =>
    verificaDocumentaleParte(v, v.docId, now, atecoAllowed, false),
  );
  const verdettoAcquirente = verificaDocumentaleParte(
    acquirente,
    acquirenteDocId,
    now,
    atecoAllowed,
    tipo === 'MINIVOLTURA',
  );
  const verdettiCoAcquirenti = coAcquirenti.map((c) =>
    verificaDocumentaleParte(c, c.docId, now, atecoAllowed, false),
  );

  // Blocco UI di un singolo venditore (riusato dal layout singolo e dall'accordion
  // multiplo). `idx` è l'indice GLOBALE nell'array venditori (handler + slot file).
  const renderVenditore = (
    v: VenditoreInput,
    idx: number,
    label: string,
    canRemove: boolean,
  ) => (
    <div key={v.id} className="space-y-5">
      <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-pv-navy-800">{label}</h2>
          {canRemove && (
            <button
              type="button"
              onClick={() => removeVenditore(v.id)}
              // Difesa #2: niente rimozione mentre un upload identità è in corso
              // (chiuderebbe la finestra di race sul targeting per-parte).
              disabled={identitaUploading(v.identita)}
              className="text-[12.5px] font-semibold text-pv-red-500 underline hover:text-pv-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
            >
              Rimuovi
            </button>
          )}
        </div>
        <ParteForm
          parte={v}
          onChange={(p) => updateVenditore(v.id, p)}
        />
      </div>

      <IdentitaSection
        titolo={
          label === 'Venditore'
            ? "Documento d'identità del venditore"
            : `Documento d'identità — ${label.toLowerCase()}`
        }
        docId={v.docId}
        onDocId={(t) => updateVenditore(v.id, { docId: t })}
        files={v.identita}
        isPG={v.isPG}
        tipoSoggetto={v.tipoSoggetto}
        ciTipo={v.ciTipo}
        tipiSoggetto={TIPI_SOGGETTO_VENDITORE}
        onTipoSoggetto={(next) => {
          const isPG = next === 'AZIENDA' || next === 'OPERATORE_AUTO';
          updateVenditore(v.id, {
            tipoSoggetto: next,
            isPG,
            visuraOcr: isPG ? v.visuraOcr : undefined,
            permessoOcr: next === 'STRANIERO_EXTRA_UE' ? v.permessoOcr : undefined,
          });
        }}
        onCiTipo={(next) => updateVenditore(v.id, { ciTipo: next })}
        onFiles={(updater) =>
          setVenditori((prev) =>
            prev.map((vv) => (vv.id === v.id ? { ...vv, identita: updater(vv.identita) } : vv)),
          )
        }
        onMainRef={(ref) =>
          runIdentitaOcr<VenditoreInput>(ref, v.docId, (upd) =>
            setVenditori((prev) => prev.map((vv) => (vv.id === v.id ? upd(vv) : vv))),
          )
        }
        onVisuraRef={(ref) =>
          runVisuraOcr<VenditoreInput>(ref, (upd) =>
            setVenditori((prev) => prev.map((vv) => (vv.id === v.id ? upd(vv) : vv))),
          )
        }
        onPermessoRef={(ref) =>
          runPermessoOcr<VenditoreInput>(ref, (upd) =>
            setVenditori((prev) => prev.map((vv) => (vv.id === v.id ? upd(vv) : vv))),
          )
        }
        onInvalidateVisura={() =>
          setVenditori((prev) =>
            prev.map((vv) => (vv.id === v.id ? { ...vv, visuraOcr: undefined } : vv)),
          )
        }
        onInvalidatePermesso={() =>
          setVenditori((prev) =>
            prev.map((vv) => (vv.id === v.id ? { ...vv, permessoOcr: undefined } : vv)),
          )
        }
        onCfRef={(ref) =>
          runCfOcr<VenditoreInput>(ref, (upd) =>
            setVenditori((prev) => prev.map((vv) => (vv.id === v.id ? upd(vv) : vv))),
          )
        }
        onInvalidateCf={() =>
          setVenditori((prev) =>
            prev.map((vv) => (vv.id === v.id ? { ...vv, codiceFiscaleOcr: undefined } : vv)),
          )
        }
        onInvalidateIdentita={() =>
          setVenditori((prev) =>
            prev.map((vv) => (vv.id === v.id ? { ...vv, identitaOcr: undefined } : vv)),
          )
        }
      />

      {verdettiVenditori[idx] &&
        !verdettiVenditori[idx]!.ok &&
        parteCompleta(v, v.docId, v.identita) && (
        <Alert variant="error">
          <strong>Verifica documenti del venditore non superata:</strong>
          <ul className="mt-1 list-disc pl-5">
            {verdettiVenditori[idx]!.problemi.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );

  // Blocco di un singolo co-intestatario acquirente (solo SEMPLICE): stesso
  // layout del principale (tipo soggetto in cima → anagrafica → documento →
  // residenza). Verifica documentale per-parte identica all'acquirente.
  const renderCoAcquirente = (c: CoAcquirenteInput, idx: number) => (
    <div key={c.id} className="space-y-5">
      <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-pv-navy-800">
            Co-intestatario {idx + 1}
          </h2>
          <button
            type="button"
            onClick={() => removeCoAcquirente(c.id)}
            disabled={identitaUploading(c.identita)}
            className="text-[12.5px] font-semibold text-pv-red-500 underline hover:text-pv-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
          >
            Rimuovi
          </button>
        </div>
        <Field label="Tipo soggetto" required>
          <Select
            value={c.tipoSoggetto ?? ''}
            onChange={(e) => {
              const next = e.target.value as TipoSoggetto;
              const isPG = next === 'AZIENDA' || next === 'OPERATORE_AUTO';
              updateCoAcquirente(c.id, {
                tipoSoggetto: next,
                isPG,
                visuraOcr: isPG ? c.visuraOcr : undefined,
                permessoOcr: next === 'STRANIERO_EXTRA_UE' ? c.permessoOcr : undefined,
              });
            }}
          >
            <option value="" disabled>
              Seleziona tipo…
            </option>
            {acquirenteTipiSoggetto.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="my-3 h-px bg-pv-slate-200" />
        <ParteForm parte={c} onChange={(p) => updateCoAcquirente(c.id, p)} />
      </div>

      <IdentitaSection
        titolo={`Documento d'identità — co-intestatario ${idx + 1}`}
        hideTipoSoggetto
        docId={c.docId}
        onDocId={(t) => updateCoAcquirente(c.id, { docId: t })}
        files={c.identita}
        isPG={c.isPG}
        tipoSoggetto={c.tipoSoggetto}
        ciTipo={c.ciTipo}
        tipiSoggetto={acquirenteTipiSoggetto}
        onTipoSoggetto={(next) => {
          const isPG = next === 'AZIENDA' || next === 'OPERATORE_AUTO';
          updateCoAcquirente(c.id, { tipoSoggetto: next, isPG });
        }}
        onCiTipo={(next) => updateCoAcquirente(c.id, { ciTipo: next })}
        onFiles={(updater) =>
          setCoAcquirenti((prev) =>
            prev.map((cc) => (cc.id === c.id ? { ...cc, identita: updater(cc.identita) } : cc)),
          )
        }
        onMainRef={(ref) =>
          runIdentitaOcr<CoAcquirenteInput>(ref, c.docId, (upd) =>
            setCoAcquirenti((prev) => prev.map((cc) => (cc.id === c.id ? upd(cc) : cc))),
          )
        }
        onVisuraRef={(ref) =>
          runVisuraOcr<CoAcquirenteInput>(ref, (upd) =>
            setCoAcquirenti((prev) => prev.map((cc) => (cc.id === c.id ? upd(cc) : cc))),
          )
        }
        onPermessoRef={(ref) =>
          runPermessoOcr<CoAcquirenteInput>(ref, (upd) =>
            setCoAcquirenti((prev) => prev.map((cc) => (cc.id === c.id ? upd(cc) : cc))),
          )
        }
        onInvalidateVisura={() =>
          setCoAcquirenti((prev) =>
            prev.map((cc) => (cc.id === c.id ? { ...cc, visuraOcr: undefined } : cc)),
          )
        }
        onInvalidatePermesso={() =>
          setCoAcquirenti((prev) =>
            prev.map((cc) => (cc.id === c.id ? { ...cc, permessoOcr: undefined } : cc)),
          )
        }
        onCfRef={(ref) =>
          runCfOcr<CoAcquirenteInput>(ref, (upd) =>
            setCoAcquirenti((prev) => prev.map((cc) => (cc.id === c.id ? upd(cc) : cc))),
          )
        }
        onInvalidateCf={() =>
          setCoAcquirenti((prev) =>
            prev.map((cc) => (cc.id === c.id ? { ...cc, codiceFiscaleOcr: undefined } : cc)),
          )
        }
        onInvalidateIdentita={() =>
          setCoAcquirenti((prev) =>
            prev.map((cc) => (cc.id === c.id ? { ...cc, identitaOcr: undefined } : cc)),
          )
        }
      />

      <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
        <p className="mb-2 text-[14px] font-semibold text-pv-navy-800">
          L&apos;indirizzo di residenza è lo stesso indicato nel documento?
        </p>
        <div className="inline-flex overflow-hidden rounded-[10px] border border-pv-slate-300">
          <button
            type="button"
            onClick={() => updateCoAcquirente(c.id, { residenzaDiversa: false, indirizzoResidenza: '' })}
            className={`px-5 py-2 text-[13px] font-semibold transition ${
              !c.residenzaDiversa
                ? 'bg-pv-navy-800 text-white'
                : 'bg-white text-pv-slate-700 hover:bg-pv-slate-50'
            }`}
          >
            Sì
          </button>
          <button
            type="button"
            onClick={() => updateCoAcquirente(c.id, { residenzaDiversa: true })}
            className={`border-l border-pv-slate-300 px-5 py-2 text-[13px] font-semibold transition ${
              c.residenzaDiversa
                ? 'bg-pv-navy-800 text-white'
                : 'bg-white text-pv-slate-700 hover:bg-pv-slate-50'
            }`}
          >
            No
          </button>
        </div>
        {c.residenzaDiversa && (
          <div className="mt-4">
            {hasMaps ? (
              <AddressAutocomplete
                label="Nuovo indirizzo di residenza"
                placeholder="Via, civico, città…"
                helpText="Inizia a digitare e seleziona dall'elenco."
                onSelect={(p) => updateCoAcquirente(c.id, { indirizzoResidenza: formatIndirizzo(p) })}
              />
            ) : (
              <Input
                value={c.indirizzoResidenza}
                onChange={(e) => updateCoAcquirente(c.id, { indirizzoResidenza: e.target.value })}
                placeholder="Via, civico, città…"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );

  // Allegati delega/procura a vendere per un veicolo (solo se flag = Sì).
  // Due UploadCard riusate (stessa grafica + scanner). Nessun OCR.
  const renderDelegaDocs = (ord: number) => {
    const veic = veicoli[ord - 1];
    if (!veic?.flagDelegaVendita) return null;
    const kDel = delegatoDocKey(ord);
    const kProc = procuraDelegaDocKey(ord);
    return (
      <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
        <h3 className="mb-1 text-[14px] font-bold text-pv-navy-800">
          Delega a vendere
        </h3>
        <p className="mb-4 text-[12.5px] text-pv-slate-500">
          Allega il documento del delegato e la procura notarile a vendere
          (obbligatori).
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UploadCard
            label="Documento del delegato"
            slot={documenti[kDel]}
            onSelect={(file) => uploadDocumento(kDel, file)}
            onRemove={() => uploadDocumento(kDel, null)}
          />
          <UploadCard
            label="Procura notarile a vendere"
            slot={documenti[kProc]}
            onSelect={(file) => uploadDocumento(kProc, file)}
            onRemove={() => uploadDocumento(kProc, null)}
          />
        </div>
      </div>
    );
  };

  // Gate per lasciare lo step 2 (Venditore): ogni venditore valido + identità
  // presente (BlobRef) + nessun upload in corso + verifica documentale OK
  // (fail-closed) + nessun mismatch insiemistico.
  const delegaCompleta = delegaDocsComplete(veicoli, (k) => {
    const s = documenti[k];
    return !!s?.ref && !s.uploading;
  });
  const canStep2 =
    venditori.every(
      (v, i) =>
        parteValida(v) &&
        identitaPresente(v.docId, v.identita) &&
        !identitaUploading(v.identita) &&
        verdettiVenditori[i]!.ok,
    ) &&
    ccVend !== 'MISMATCH' &&
    delegaCompleta;

  // Gate per lasciare lo step 3 (Acquirente): parte valida + identità (BlobRef)
  // pronta + nessun upload in corso + verifica documentale OK (fail-closed).
  const residenzaAcqOk = residenzaOk(
    acquirenteResidenzaDiversa,
    acquirenteIndirizzoResidenza,
  );
  const coAcquirentiOk = coAcquirenti.every(
    (c, i) =>
      parteValida(c) &&
      identitaPresente(c.docId, c.identita) &&
      !identitaUploading(c.identita) &&
      verdettiCoAcquirenti[i]!.ok &&
      residenzaOk(c.residenzaDiversa, c.indirizzoResidenza),
  );
  const canStep3 =
    parteValida(acquirente) &&
    identitaPresente(acquirenteDocId, acquirenteIdentita) &&
    !identitaUploading(acquirenteIdentita) &&
    verdettoAcquirente.ok &&
    residenzaAcqOk &&
    coAcquirentiOk;

  // Schema Documentale v7 (SD-B): blocca il submit se l'engine non torna OK
  // (BLOCCO o INPUT_INCOMPLETO). Lo step 3 mostra l'esito tramite
  // SchemaDocumentalePreview così il broker capisce cosa correggere.
  const canSubmit =
    (!multiSede || brokerSedeId.length > 0) &&
    comune.trim().length > 0 &&
    /^[A-Za-z]{2}$/.test(provincia.trim()) &&
    esitoSchema.kind === 'OK';

  // Punto 3: il tasto di proseguimento resta "disabilitato" (look) ma cliccabile;
  // al click con dati incompleti mostra un toast con cosa manca.
  const avvisaMancanze = (mancanze: string[]): void => {
    toast(
      mancanze.length > 0
        ? `Per proseguire manca: ${mancanze.join(' · ')}`
        : 'Completa i dati richiesti per proseguire',
      'info',
    );
  };
  const mancanzeStep1 = (): string[] => {
    if (librettiUploading) return ['attendere il caricamento del documento'];
    const m: string[] = [];
    veicoli.forEach((v, i) => {
      const tag = veicoli.length > 1 ? ` (veicolo ${i + 1})` : '';
      const docManca = docVeicoloMancante({
        tipoDocumento: v.tipoDocumento,
        librettoFronte: !!v.libretto.ref,
        librettoRetro: !!v.librettoRetro.ref,
        ocr: !!v.ocr,
        foglio: !!v.foglioComplementare.ref,
      });
      if (docManca) m.push(`${docManca}${tag}`);
      if (v.targa.length < 5) m.push(`targa${tag}`);
      if (v.telaio.length < 11) m.push(`telaio${tag}`);
      if (!v.proprietarioAttuale.trim()) m.push(`proprietario${tag}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.dataImmatricolazione))
        m.push(`data immatricolazione${tag}`);
      if (!(Number(v.prezzoVendita) > 0)) m.push(`prezzo di vendita${tag}`);
      if (v.preImm2015 && !documenti[cdpDocKey(i + 1)]?.ref)
        m.push(`certificato di proprietà${tag}`);
    });
    return m;
  };
  const mancanzeStep2 = (): string[] => {
    const m: string[] = [];
    venditori.forEach((v, i) => {
      const tag = venditori.length > 1 ? ` (venditore ${i + 1})` : '';
      mancanzeParte(v, v.docId, v.identita).forEach((x) => m.push(`${x}${tag}`));
      if (parteCompleta(v, v.docId, v.identita) && !verdettiVenditori[i]!.ok)
        m.push(`documenti venditore da correggere${tag}`);
    });
    if (ccVend === 'MISMATCH') m.push('i venditori non corrispondono al libretto');
    if (!delegaCompleta) m.push('allegati delega/procura');
    return m;
  };
  const mancanzeStep3 = (): string[] => {
    const m = mancanzeParte(acquirente, acquirenteDocId, acquirenteIdentita);
    if (
      parteCompleta(acquirente, acquirenteDocId, acquirenteIdentita) &&
      !verdettoAcquirente.ok
    )
      m.push('documenti acquirente da correggere');
    if (acquirenteResidenzaDiversa && !acquirenteIndirizzoResidenza.trim())
      m.push('indirizzo di residenza');
    coAcquirenti.forEach((c, i) => {
      const tag = ` (co-intestatario ${i + 1})`;
      mancanzeParte(c, c.docId, c.identita).forEach((x) => m.push(`${x}${tag}`));
      if (parteCompleta(c, c.docId, c.identita) && !verdettiCoAcquirenti[i]!.ok)
        m.push(`documenti co-intestatario da correggere${tag}`);
      if (!residenzaOk(c.residenzaDiversa, c.indirizzoResidenza))
        m.push(`indirizzo di residenza${tag}`);
    });
    return m;
  };
  const mancanzeStep4 = (): string[] => {
    const m: string[] = [];
    if (multiSede && !brokerSedeId) m.push('sede di partenza');
    if (!comune.trim()) m.push('comune');
    if (!/^[A-Za-z]{2}$/.test(provincia.trim())) m.push('provincia (2 lettere)');
    if (esitoSchema.kind !== 'OK') m.push('documenti richiesti incompleti');
    return m;
  };

  return (
    <>
      {/* sidebar broker: nessun header desktop → la barra step sta a filo top
          (lg:top-0); su mobile resta sotto l'header hamburger (top-14). */}
      <WizardProgress
        steps={STEPS}
        current={step}
        label="Nuova pratica"
        stickyOffset="top-14 lg:top-0"
      />
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              {current.title}
            </h1>
            <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-pv-slate-500">
              {current.hint}
            </p>
          </div>
          {/* La bozza è salvata in automatico: un refresh non perde i dati.
              "Ricomincia da capo" la svuota e riparte da zero. */}
          <button
            type="button"
            onClick={ricominciaDaCapo}
            className="mt-1 shrink-0 whitespace-nowrap text-[12.5px] font-semibold text-pv-slate-500 underline hover:text-pv-red-500"
          >
            Ricomincia da capo
          </button>
        </header>

        {error && (
          <div className="mb-5">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                Tipo pratica (Seleziona la tipologia di pratica)
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {TIPO_CARDS.map((card) => {
                  const selected = tipo === card.tipo && multiplo === card.multiplo;
                  return (
                    <button
                      key={card.key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => handleCardSelect(card)}
                      className={`rounded-[12px] border-2 p-4 text-left transition ${
                        selected
                          ? 'border-pv-orange-500 bg-pv-orange-500/10 ring-1 ring-pv-orange-500 shadow-[var(--pv-shadow-card)]'
                          : 'border-pv-slate-200 bg-white hover:border-pv-navy-400'
                      }`}
                    >
                      <span
                        className={`block text-[14px] font-bold ${
                          selected ? 'text-pv-orange-600' : 'text-pv-navy-900'
                        }`}
                      >
                        {card.label}
                      </span>
                      <span className="mt-1 block text-[12.5px] text-pv-slate-600">
                        {card.descrizione}
                      </span>
                    </button>
                  );
                })}
              </div>

              {multiplo && (
                <div className="mt-4">
                  <Field label="Numero veicoli" required>
                    <NumberInput
                      min={2}
                      max={50}
                      integer
                      value={numeroVeicoli}
                      onChange={(n) => changeNumeroVeicoli(n ?? 2)}
                    />
                  </Field>
                  <p className="mt-1 text-[12px] text-pv-slate-500">
                    Le pratiche multiple richiedono da 2 a 50 veicoli.
                  </p>
                </div>
              )}
            </div>

            {veicoli.map((v, idx) => (
              <div key={idx} className="space-y-3">
                <VeicoloSection
                  ordine={idx + 1}
                  veicolo={v}
                  multiplo={multiplo}
                  onFronte={(file) => onFronteSelected(idx, file)}
                  onRetro={(file) => onRetroSelected(idx, file)}
                  onFoglio={(file) => onFoglioSelected(idx, file)}
                  onTipoDocumento={(t) => onTipoDocumentoSelected(idx, t)}
                  onChange={(patch) => {
                    // Delega → No: scarta gli allegati delega/procura già
                    // caricati per questo veicolo (niente blob orfani né slot
                    // stantii trascinati nel submit).
                    if (patch.flagDelegaVendita === false) {
                      uploadDocumento(delegatoDocKey(idx + 1), null);
                      uploadDocumento(procuraDelegaDocKey(idx + 1), null);
                    }
                    updateVeicolo(idx, patch);
                  }}
                />
                {/* Veicolo pre-2015: serve il Certificato di Proprietà (documento
                    del veicolo, caricato qui insieme al libretto). */}
                {v.preImm2015 && (
                  <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
                    <h3 className="mb-1 text-[14px] font-bold text-pv-navy-800">
                      Certificato di Proprietà{multiplo ? ` — Veicolo ${idx + 1}` : ''}
                    </h3>
                    <p className="mb-3 text-[12px] text-pv-slate-500">
                      Veicolo immatricolato prima del 2015: carica il Certificato di Proprietà.
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <UploadCard
                        label="Certificato di Proprietà"
                        slot={documenti[cdpDocKey(idx + 1)]}
                        onSelect={(file) => uploadDocumento(cdpDocKey(idx + 1), file)}
                        onRemove={() =>
                          setDocumenti((m) => {
                            const n = { ...m };
                            delete n[cdpDocKey(idx + 1)];
                            return n;
                          })
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}

            <div className="flex justify-end">
              <Button
                className={!canStep1 ? 'opacity-50' : undefined}
                onClick={() => {
                  if (!canStep1) return avvisaMancanze(mancanzeStep1());
                  setStep(2);
                }}
              >
                Avanti
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <Alert variant="warning" title="I documenti vanno portati in agenzia">
              Tutti i documenti vanno consegnati <strong>in originale e di
              persona, fisicamente in agenzia</strong>, al momento della firma.
              Gli upload qui servono solo per avviare la pratica.
            </Alert>

            {multiplo ? (
              veicoli.map((veic, vi) => {
                const ord = vi + 1;
                const gruppo = venditori
                  .map((v, idx) => ({ v, idx }))
                  .filter((x) => x.v.veicoloOrdine === ord);
                const aperto = veicoloAperto === ord;
                return (
                  <div
                    key={ord}
                    ref={(el) => {
                      cardRefs.current[ord] = el;
                    }}
                    className="scroll-mt-4 overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]"
                  >
                    <button
                      type="button"
                      onClick={() => setVeicoloAperto(aperto ? -1 : ord)}
                      className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                    >
                      <span className="text-[15px] font-bold text-pv-navy-800">
                        Veicolo {ord} — {veic.targa || '—'}
                      </span>
                      <span className="flex items-center gap-2 text-[12.5px] font-semibold text-pv-slate-500">
                        {ccPerVeicolo[ord] === 'MISMATCH' && (
                          <span className="text-pv-red-500">⚠ verifica intestatari</span>
                        )}
                        <svg
                          className={`h-4 w-4 transition-transform ${aperto ? 'rotate-180' : ''}`}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </span>
                    </button>
                    {aperto && (
                      <div className="space-y-5 border-t border-pv-slate-100 p-5">
                        {ccPerVeicolo[ord] === 'MISMATCH' && (
                          <Alert variant="error">
                            I venditori non corrispondono agli intestatari del libretto di questo
                            veicolo
                            {(proprietariPerVeicolo[ord]?.length ?? 0) > 0 && (
                              <> ({proprietariPerVeicolo[ord]!.join(', ')})</>
                            )}
                            . Verifica i nominativi o aggiungi i co-intestatari mancanti.
                          </Alert>
                        )}
                        {gruppo.map(({ v, idx }, gi) =>
                          renderVenditore(
                            v,
                            idx,
                            gruppo.length > 1 ? `Venditore ${gi + 1}` : 'Venditore',
                            venditori.length > 1,
                          ),
                        )}
                        <div className="flex justify-start">
                          <Button variant="secondary" onClick={() => addVenditore(ord)}>
                            + Aggiungi co-intestatario
                          </Button>
                        </div>
                        {renderDelegaDocs(ord)}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <>
                {ccVend === 'MISMATCH' && (
                  <Alert variant="error">
                    I venditori non corrispondono agli intestatari del libretto
                    {(proprietariPerVeicolo[1]?.length ?? 0) > 0 && (
                      <> ({proprietariPerVeicolo[1]!.join(', ')})</>
                    )}
                    . Verifica i nominativi o aggiungi i co-intestatari mancanti.
                  </Alert>
                )}
                {venditori.map((v, idx) =>
                  renderVenditore(
                    v,
                    idx,
                    venditori.length > 1 ? `Venditore ${idx + 1}` : 'Venditore',
                    venditori.length > 1,
                  ),
                )}
                <div className="flex justify-start">
                  <Button variant="secondary" onClick={() => addVenditore(1)}>
                    + Aggiungi venditore (co-intestatario)
                  </Button>
                </div>
                {renderDelegaDocs(1)}
              </>
            )}

            {!delegaCompleta && (
              <Alert variant="error">
                Per i veicoli con delega/procura a vendere, carica sia il documento
                del delegato sia la procura notarile prima di procedere.
              </Alert>
            )}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button variant="secondary" onClick={() => setStep(1)}>
                Indietro
              </Button>
              <Button
                className={!canStep2 ? 'opacity-50' : undefined}
                onClick={() => {
                  if (!canStep2) return avvisaMancanze(mancanzeStep2());
                  setStep(3);
                }}
              >
                Avanti
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <Alert variant="warning" title="I documenti vanno portati in agenzia">
              Tutti i documenti vanno consegnati <strong>in originale e di
              persona, fisicamente in agenzia</strong>, al momento della firma.
              Gli upload qui servono solo per avviare la pratica.
            </Alert>

            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">Acquirente</h2>
              {tipo === 'MINIVOLTURA' && (
                <p className="mb-3 text-[12px] text-pv-slate-500">
                  Nelle minivolture l&apos;acquirente è un commerciante d&apos;auto
                  (operatore auto), con visura camerale.
                </p>
              )}
              <Field label="Tipo soggetto" required>
                <Select
                  value={acquirente.tipoSoggetto ?? ''}
                  onChange={(e) => {
                    const next = e.target.value as TipoSoggetto;
                    const isPG = next === 'AZIENDA' || next === 'OPERATORE_AUTO';
                    setAcquirente((prev) => ({
                      ...prev,
                      tipoSoggetto: next,
                      isPG,
                      visuraOcr: isPG ? prev.visuraOcr : undefined,
                      permessoOcr: next === 'STRANIERO_EXTRA_UE' ? prev.permessoOcr : undefined,
                    }));
                  }}
                >
                  <option value="" disabled>
                    Seleziona tipo…
                  </option>
                  {acquirenteTipiSoggetto.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="my-3 h-px bg-pv-slate-200" />
              <ParteForm parte={acquirente} onChange={setAcquirente} />
            </div>

            <IdentitaSection
              titolo={
                tipo === 'MINIVOLTURA'
                  ? "Documento d'identità dell'acquirente (dell'amministratore o del delegato alla firma)"
                  : "Documento d'identità dell'acquirente"
              }
              hideTipoSoggetto
              docId={acquirenteDocId}
              onDocId={setAcquirenteDocId}
              files={acquirenteIdentita}
              isPG={acquirente.isPG}
              tipoSoggetto={acquirente.tipoSoggetto}
              ciTipo={acquirente.ciTipo}
              tipiSoggetto={acquirenteTipiSoggetto}
              onTipoSoggetto={(next) => {
                const isPG = next === 'AZIENDA' || next === 'OPERATORE_AUTO';
                setAcquirente((prev) => ({
                  ...prev,
                  tipoSoggetto: next,
                  isPG,
                  visuraOcr: isPG ? prev.visuraOcr : undefined,
                  permessoOcr: next === 'STRANIERO_EXTRA_UE' ? prev.permessoOcr : undefined,
                }));
              }}
              onCiTipo={(next) => setAcquirente((prev) => ({ ...prev, ciTipo: next }))}
              onFiles={setAcquirenteIdentita}
              onMainRef={(ref) =>
                runIdentitaOcr(ref, acquirenteDocId, (updater) =>
                  setAcquirente((prev) => updater(prev)),
                )
              }
              onVisuraRef={(ref) =>
                runVisuraOcr(ref, (updater) =>
                  setAcquirente((prev) => updater(prev)),
                )
              }
              onPermessoRef={(ref) =>
                runPermessoOcr(ref, (updater) =>
                  setAcquirente((prev) => updater(prev)),
                )
              }
              onInvalidateVisura={() =>
                setAcquirente((prev) => ({ ...prev, visuraOcr: undefined }))
              }
              onInvalidatePermesso={() =>
                setAcquirente((prev) => ({ ...prev, permessoOcr: undefined }))
              }
              onCfRef={(ref) =>
                runCfOcr(ref, (updater) => setAcquirente((prev) => updater(prev)))
              }
              onInvalidateCf={() =>
                setAcquirente((prev) => ({ ...prev, codiceFiscaleOcr: undefined }))
              }
              onInvalidateIdentita={() =>
                setAcquirente((prev) => ({ ...prev, identitaOcr: undefined }))
              }
            />

            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <p className="mb-2 text-[14px] font-semibold text-pv-navy-800">
                L&apos;indirizzo di residenza è lo stesso indicato nel documento?
              </p>
              <div className="inline-flex overflow-hidden rounded-[10px] border border-pv-slate-300">
                <button
                  type="button"
                  onClick={() => {
                    setAcquirenteResidenzaDiversa(false);
                    setAcquirenteIndirizzoResidenza('');
                  }}
                  className={`px-5 py-2 text-[13px] font-semibold transition ${
                    !acquirenteResidenzaDiversa
                      ? 'bg-pv-navy-800 text-white'
                      : 'bg-white text-pv-slate-700 hover:bg-pv-slate-50'
                  }`}
                >
                  Sì
                </button>
                <button
                  type="button"
                  onClick={() => setAcquirenteResidenzaDiversa(true)}
                  className={`border-l border-pv-slate-300 px-5 py-2 text-[13px] font-semibold transition ${
                    acquirenteResidenzaDiversa
                      ? 'bg-pv-navy-800 text-white'
                      : 'bg-white text-pv-slate-700 hover:bg-pv-slate-50'
                  }`}
                >
                  No
                </button>
              </div>

              {acquirenteResidenzaDiversa && (
                <div className="mt-4">
                  <p className="mb-2 text-[12.5px] text-pv-slate-500">
                    Indica la residenza attuale dell&apos;acquirente: l&apos;agenzia
                    intesterà il passaggio a questo indirizzo.
                  </p>
                  {hasMaps ? (
                    <>
                      <AddressAutocomplete
                        label="Nuovo indirizzo di residenza"
                        placeholder="Via, civico, città…"
                        helpText="Inizia a digitare e seleziona dall'elenco."
                        onSelect={(p) => setAcquirenteIndirizzoResidenza(formatIndirizzo(p))}
                      />
                      {acquirenteIndirizzoResidenza && (
                        <p className="mt-2 text-[13px] text-pv-slate-700">
                          Indirizzo selezionato: <strong>{acquirenteIndirizzoResidenza}</strong>
                        </p>
                      )}
                    </>
                  ) : (
                    <Field label="Nuovo indirizzo di residenza" required>
                      <Input
                        value={acquirenteIndirizzoResidenza}
                        onChange={(e) => setAcquirenteIndirizzoResidenza(e.target.value)}
                        placeholder="Via Roma 12, 20100 Milano (MI)"
                      />
                    </Field>
                  )}
                </div>
              )}
            </div>

            {tipo === 'SEMPLICE' && (
              <>
                {coAcquirenti.map((c, idx) => renderCoAcquirente(c, idx))}
                <button
                  type="button"
                  onClick={addCoAcquirente}
                  className="w-full rounded-[12px] border border-dashed border-pv-navy-300 bg-pv-navy-50 px-4 py-3 text-[13px] font-semibold text-pv-navy-700 transition hover:bg-pv-navy-100"
                >
                  + Aggiungi co-intestatario
                </button>
              </>
            )}

            {/* Verifica documentale OCR (fail-closed): finché ci sono problemi
                l'acquirente non supera il gate "Avanti". */}
            {!verdettoAcquirente.ok &&
              parteCompleta(acquirente, acquirenteDocId, acquirenteIdentita) && (
              <Alert variant="error">
                <strong>Verifica documenti dell&apos;acquirente non superata:</strong>
                <ul className="mt-1 list-disc pl-5">
                  {verdettoAcquirente.problemi.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </Alert>
            )}

            {acquirenteResidenzaDiversa && !acquirenteIndirizzoResidenza.trim() && (
              <Alert variant="error">
                Inserisci il nuovo indirizzo di residenza dell&apos;acquirente per procedere.
              </Alert>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button variant="secondary" onClick={() => setStep(2)}>
                Indietro
              </Button>
              <Button
                className={!canStep3 ? 'opacity-50' : undefined}
                onClick={() => {
                  if (!canStep3) return avvisaMancanze(mancanzeStep3());
                  setStep(4);
                }}
              >
                Avanti
              </Button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            {multiSede && (
              <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
                <h2 className="mb-1 text-[15px] font-bold text-pv-navy-800">Sede di partenza</h2>
                <p className="mb-3 text-[12.5px] text-pv-slate-500">
                  La tua sede da cui nasce la pratica (per wallet, fatturazione e statistiche).
                  Non c’entra col comune di destinazione qui sotto.
                </p>
                <Field label="Sede" required>
                  <Select
                    value={brokerSedeId}
                    onChange={(e) => setBrokerSedeId(e.target.value)}
                    invalid={!brokerSedeId}
                  >
                    <option value="" disabled>
                      Seleziona una sede…
                    </option>
                    {sedi.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nome}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}

            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">
                Localizzazione (il comune dove desideri terminare il passaggio in agenzia)
              </h2>
              {hasMaps ? (
                <div>
                  <AddressAutocomplete
                    label="Comune"
                    placeholder="Cerca il comune…"
                    helpText="Inizia a digitare e seleziona il comune dall'elenco: niente errori di battitura."
                    onSelect={(p) => {
                      if (p.citta) setComune(p.citta);
                      if (p.provincia) setProvincia(p.provincia);
                    }}
                  />
                  {comune && (
                    <p className="mt-2 text-[13px] text-pv-slate-700">
                      Comune selezionato:{' '}
                      <strong>
                        {comune}
                        {provincia && ` (${provincia})`}
                      </strong>{' '}
                      (verrà inviata la richiesta alle agenzie di {comune} o alle più vicine
                      disponibili)
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Comune" required className="sm:col-span-2">
                    <Input value={comune} onChange={(e) => setComune(e.target.value)} placeholder="Venezia" />
                  </Field>
                  <Field label="Provincia" required>
                    <Input
                      maxLength={2}
                      value={provincia}
                      onChange={(e) => setProvincia(e.target.value.toUpperCase())}
                      placeholder="VE"
                    />
                  </Field>
                </div>
              )}
            </div>

            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">Riepilogo</h2>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
                <RiepilogoRow label="Tipo" value={labelTipo(tipo, multiplo)} />
                <RiepilogoRow label="Numero veicoli" value={String(numeroVeicoli)} />
                <RiepilogoRow
                  label={venditori.length > 1 ? 'Venditori' : 'Venditore'}
                  value={venditori.map((v) => parteNome(v)).join(', ')}
                />
                <RiepilogoRow
                  label="Acquirente"
                  value={parteNome(acquirente)}
                />
                {multiSede && (
                  <RiepilogoRow
                    label="Sede di partenza"
                    value={sedi.find((s) => s.id === brokerSedeId)?.nome || '—'}
                  />
                )}
                <RiepilogoRow label="Comune" value={comune || '—'} />
              </dl>
              <div className="mt-3 space-y-2">
                {veicoli.map((v, i) => (
                  <div
                    key={i}
                    className="rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 p-3 text-[12.5px]"
                  >
                    <p className="font-bold text-pv-navy-800">Veicolo {i + 1}</p>
                    <p className="mt-1 text-pv-slate-700">
                      {v.targa || '—'} · {v.telaio || '—'} · {v.fileName ?? 'nessun libretto'}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Schema Documentale v7 (SD-B): preview documenti richiesti via
                engine puro. Mostra blocchi/incompletezze in tempo reale e
                lista doc obbligatori per il broker, raggruppati per parte/veicolo. */}
            <SchemaDocumentalePreview esito={esitoSchema} />

            {hasCoIntestatariVenditori && (
              <Alert variant="warning" title="Co-intestatari: presenza fisica richiesta">
                Entrambi i co-intestatari dovranno presentarsi fisicamente in agenzia al
                momento della firma con i loro documenti.
              </Alert>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button variant="secondary" onClick={() => setStep(3)} disabled={submitting}>
                Indietro
              </Button>
              <Button
                className={!canSubmit && !submitting ? 'opacity-50' : undefined}
                onClick={() => {
                  if (!canSubmit) return avvisaMancanze(mancanzeStep4());
                  setDichiarazioneAccettata(false);
                  setShowDichiarazione(true);
                }}
                disabled={submitting}
                loading={submitting}
                loadingLabel="Invio pratica…"
              >
                Invia pratica alle agenzie
              </Button>
            </div>
          </div>
        )}
      </div>

      <DichiarazionePopup
        open={showDichiarazione}
        accepted={dichiarazioneAccettata}
        pending={submitting}
        onAcceptedChange={setDichiarazioneAccettata}
        onConfirm={() => {
          setShowDichiarazione(false);
          handleFinalSubmit();
        }}
        onClose={() => setShowDichiarazione(false)}
      />

      <RevisioneManualePopup
        praticaId={null}
        open={showRevisione}
        onClose={() => setShowRevisione(false)}
      />
    </>
  );

  // Carica un documento richiesto su Blob (client upload) e ne salva la BlobRef
  // nello stato `documenti` (chiave docKey). Mostra progress/errore per-file.
  function uploadDocumento(k: string, file: File | null) {
    if (!file) {
      setDocumenti((m) => {
        const n = { ...m };
        delete n[k];
        return n;
      });
      return;
    }
    setDocumenti((m) => ({
      ...m,
      [k]: { ref: null, file, uploading: true, progress: 0, error: null },
    }));
    void uploadToBlob(file, 'pratiche-staging', (pct) => {
      setDocumenti((m) => {
        const cur = m[k];
        if (!cur) return m;
        return { ...m, [k]: { ...cur, progress: pct } };
      });
    })
      .then((ref) => {
        setDocumenti((m) => ({
          ...m,
          [k]: { ref, file, uploading: false, progress: 100, error: null },
        }));
      })
      .catch((err: unknown) => {
        setDocumenti((m) => ({
          ...m,
          [k]: {
            ref: null,
            file,
            uploading: false,
            progress: 0,
            error: (err as Error).message,
          },
        }));
      });
  }
}

/**
 * Sezione veicolo ripetuta: upload libretto fronte+retro → OCR combinato →
 * campi editabili. Una istanza per veicolo (ordine 1..n).
 */
function VeicoloSection({
  ordine,
  veicolo,
  multiplo,
  onFronte,
  onRetro,
  onFoglio,
  onTipoDocumento,
  onChange,
}: {
  ordine: number;
  veicolo: VeicoloInput;
  multiplo: boolean;
  onFronte: (file: File | undefined) => void;
  onRetro: (file: File | undefined) => void;
  onFoglio: (file: File | undefined) => void;
  onTipoDocumento: (t: TipoDocumentoVeicolo) => void;
  onChange: (patch: Partial<VeicoloInput>) => void;
}) {
  const hasOcr = !!veicolo.ocr;
  const isFoglio = veicolo.tipoDocumento === 'FOGLIO_COMPLEMENTARE';
  // Campi anagrafici editabili: per il libretto dopo l'OCR; per il foglio
  // complementare appena il PDF è caricato (inserimento manuale).
  const mostraCampi = isFoglio ? !!veicolo.foglioComplementare.ref : hasOcr;
  return (
    <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
      <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">
        {multiplo ? `Veicolo ${ordine}` : 'Veicolo'}
      </h2>
      {/* La domanda precede gli upload: in base alla risposta cambia cosa caricare. */}
      <p className="mb-2 text-[13px] font-semibold text-pv-navy-800">
        Sei in possesso di un normale libretto auto o di un foglio complementare?
      </p>
      <div className="mb-4 inline-flex overflow-hidden rounded-[10px] border border-pv-slate-300">
        <button
          type="button"
          onClick={() => onTipoDocumento('LIBRETTO')}
          className={`px-4 py-2 text-[13px] font-semibold transition ${
            !isFoglio
              ? 'bg-pv-navy-800 text-white'
              : 'bg-white text-pv-slate-700 hover:bg-pv-slate-50'
          }`}
        >
          Libretto auto
        </button>
        <button
          type="button"
          onClick={() => onTipoDocumento('FOGLIO_COMPLEMENTARE')}
          className={`border-l border-pv-slate-300 px-4 py-2 text-[13px] font-semibold transition ${
            isFoglio
              ? 'bg-pv-navy-800 text-white'
              : 'bg-white text-pv-slate-700 hover:bg-pv-slate-50'
          }`}
        >
          Foglio complementare
        </button>
      </div>

      {isFoglio ? (
        <>
          <p className="mb-3 text-[12.5px] text-pv-slate-500">
            Carica il <strong>foglio complementare</strong> come PDF o foto (JPG/PNG):
            potrai ritagliarlo e migliorarlo prima dell&apos;invio. Subentra
            tipicamente quando vende un commerciante d&apos;auto. I dati del veicolo
            vanno inseriti a mano qui sotto.
          </p>
          <div className="grid grid-cols-1 gap-3">
            <UploadCard
              label="Foglio complementare"
              slot={veicolo.foglioComplementare}
              subtitle="Il foglio complementare come PDF o foto (JPG/PNG)."
              onSelect={(f) => onFoglio(f ?? undefined)}
              onRemove={() => onFoglio(undefined)}
            />
          </div>
        </>
      ) : (
        <>
          <p className="mb-3 text-[12.5px] text-pv-slate-500">
            Carica entrambe le facciate del libretto di circolazione. Il retro può
            riportare etichette di trasferimento di proprietà che verranno lette
            dall&apos;OCR.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <UploadCard
              label="Libretto — fronte"
              slot={veicolo.libretto}
              onSelect={(f) => onFronte(f ?? undefined)}
              onRemove={() => onFronte(undefined)}
            />
            <UploadCard
              label="Libretto — retro"
              slot={veicolo.librettoRetro}
              onSelect={(f) => onRetro(f ?? undefined)}
              onRemove={() => onRetro(undefined)}
            />
          </div>
        </>
      )}

      {veicolo.extracting && (
        <div
          className="mt-3 flex items-center gap-3 rounded-[12px] border border-pv-navy-200 bg-pv-navy-50 p-4"
          role="status"
          aria-live="polite"
        >
          <svg
            className="h-5 w-5 shrink-0 animate-spin text-pv-navy-700"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
          <div className="flex-1">
            <p className="text-[14px] font-semibold text-pv-navy-900">
              Estrazione dati in corso…
            </p>
            <p className="mt-0.5 text-[12px] text-pv-slate-600">
              L’OCR analizza il documento: l’operazione può richiedere fino a 30-60 secondi.
              Non chiudere la pagina.
            </p>
          </div>
        </div>
      )}
      {veicolo.ocrError && (
        <div className="mt-3">
          <Alert variant="error">{veicolo.ocrError}</Alert>
        </div>
      )}

      {mostraCampi && (
        <div className="mt-4 rounded-[12px] border border-pv-slate-200 bg-pv-slate-50 p-4">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            {isFoglio
              ? 'Dati del veicolo — inseriscili a mano dove è necessario'
              : 'Dati estratti — correggi se serve'}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Targa" required>
              <Input
                value={veicolo.targa}
                onChange={(e) => onChange({ targa: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="Telaio" required>
              <Input
                value={veicolo.telaio}
                onChange={(e) => onChange({ telaio: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label="Proprietario attuale" required className="sm:col-span-2">
              <Input
                value={veicolo.proprietarioAttuale}
                onChange={(e) =>
                  onChange({ proprietarioAttuale: e.target.value })
                }
              />
            </Field>
            <Field label="Data immatricolazione" required>
              <Input
                type="date"
                value={veicolo.dataImmatricolazione}
                onChange={(e) =>
                  onChange({ dataImmatricolazione: e.target.value })
                }
              />
            </Field>
            <div className="flex flex-col gap-2 pt-6">
              <label className="flex items-center gap-2 text-[13px] text-pv-slate-700">
                <Checkbox
                  checked={veicolo.preImm2015}
                  onChange={(e) => onChange({ preImm2015: e.target.checked })}
                />
                Pre-2015 (richiede certificato di proprietà)
              </label>
            </div>
            <div className="pt-2 sm:col-span-2">
              <p className="mb-2 text-[13px] font-semibold text-pv-navy-800">
                C&apos;è una delega/procura notarile a vendere?
              </p>
              <div className="inline-flex overflow-hidden rounded-[10px] border border-pv-slate-300">
                <button
                  type="button"
                  onClick={() => onChange({ flagDelegaVendita: false })}
                  className={`px-5 py-2 text-[13px] font-semibold transition ${
                    !veicolo.flagDelegaVendita
                      ? 'bg-pv-navy-800 text-white'
                      : 'bg-white text-pv-slate-700 hover:bg-pv-slate-50'
                  }`}
                >
                  No
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ flagDelegaVendita: true })}
                  className={`border-l border-pv-slate-300 px-5 py-2 text-[13px] font-semibold transition ${
                    veicolo.flagDelegaVendita
                      ? 'bg-pv-navy-800 text-white'
                      : 'bg-white text-pv-slate-700 hover:bg-pv-slate-50'
                  }`}
                >
                  Sì
                </button>
              </div>
            </div>
            <Field label="Prezzo di vendita (€)" required className="sm:col-span-2">
              <Input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                placeholder="es. 12000"
                value={veicolo.prezzoVendita ?? ''}
                onChange={(e) => onChange({ prezzoVendita: e.target.value })}
              />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}

function ParteForm({
  parte,
  onChange,
}: {
  parte: Parte;
  onChange: (p: Parte) => void;
}) {
  // Schema Documentale v7 (SD-B): il tipo soggetto (che popola isPG e determina
  // quali documenti servono) è scelto nella sezione documenti — IdentitaSection,
  // così da essere più visibile accanto agli upload. Qui restano solo l'anagrafica
  // e i contatti della parte.
  return (
    <div>
      {parte.isPG ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Ragione sociale" required>
            <Input
              value={parte.ragioneSociale}
              onChange={(e) => onChange({ ...parte, ragioneSociale: e.target.value })}
            />
          </Field>
          <Field label="Partita IVA" required>
            <Input
              value={parte.piva}
              onChange={(e) => onChange({ ...parte, piva: e.target.value.replace(/\D/g, '') })}
              maxLength={11}
            />
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nome" required>
            <Input value={parte.nome} onChange={(e) => onChange({ ...parte, nome: e.target.value })} />
          </Field>
          <Field label="Cognome" required>
            <Input
              value={parte.cognome}
              onChange={(e) => onChange({ ...parte, cognome: e.target.value })}
            />
          </Field>
          <Field label="Codice fiscale" required className="sm:col-span-2">
            <Input
              value={parte.cf}
              onChange={(e) => onChange({ ...parte, cf: e.target.value.toUpperCase() })}
              maxLength={16}
            />
          </Field>
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Telefono" required>
          <Input
            type="tel"
            value={parte.telefono}
            onChange={(e) => onChange({ ...parte, telefono: e.target.value })}
            placeholder="+39 333 1234567"
          />
        </Field>
        <Field label="Email" required>
          <Input
            type="email"
            value={parte.email}
            onChange={(e) => onChange({ ...parte, email: e.target.value })}
            placeholder="nome@esempio.it"
          />
        </Field>
      </div>
    </div>
  );
}

const DOC_ID_OPTIONS: { value: DocIdTipo; label: string }[] = [
  { value: 'CI', label: "Carta d'identità" },
  { value: 'PASSAPORTO', label: 'Passaporto' },
  { value: 'PATENTE', label: 'Patente' },
];

/**
 * A7 + Verifica documentale: sezione "Documento d'identità" sotto ciascuna
 * parte. Il broker sceglie il tipo documento; per la CI e la patente servono
 * fronte+retro; per il passaporto basta un file singolo. In base al tipo soggetto compaiono i
 * blocchi condizionali: Visura camerale (AZIENDA / OPERATORE_AUTO) e Permesso
 * di soggiorno (STRANIERO_EXTRA_UE). Ogni file viene caricato subito su Blob
 * (client upload) e ne teniamo la BlobRef. Al completamento dell'upload parte
 * l'OCR corrispondente (identità via `onMainRef`, visura via `onVisuraRef`,
 * permesso via `onPermessoRef`) il cui risultato alimenta la verifica
 * documentale (validaParte). Al cambio file l'OCR corrispondente viene
 * invalidato via `onInvalidate*` (re-OCR solo al cambio file).
 */
function IdentitaSection({
  titolo,
  docId,
  onDocId,
  files,
  isPG,
  tipoSoggetto,
  ciTipo,
  tipiSoggetto,
  onTipoSoggetto,
  onCiTipo,
  onFiles,
  onMainRef,
  onVisuraRef,
  onPermessoRef,
  onInvalidateIdentita,
  onInvalidateVisura,
  onInvalidatePermesso,
  onCfRef,
  onInvalidateCf,
  hideTipoSoggetto = false,
}: {
  titolo: string;
  docId: DocIdTipo;
  onDocId: (t: DocIdTipo) => void;
  files: IdentitaFiles;
  isPG: boolean;
  tipoSoggetto: TipoSoggetto | null;
  ciTipo: CiTipo;
  tipiSoggetto: { value: TipoSoggetto; label: string }[];
  onTipoSoggetto: (t: TipoSoggetto) => void;
  onCiTipo: (t: CiTipo) => void;
  onFiles: (updater: (prev: IdentitaFiles) => IdentitaFiles) => void;
  onMainRef: (ref: BlobRef) => void;
  onVisuraRef: (ref: BlobRef) => void;
  onPermessoRef: (ref: BlobRef) => void;
  onInvalidateIdentita: () => void;
  onInvalidateVisura: () => void;
  onInvalidatePermesso: () => void;
  onCfRef: (ref: BlobRef) => void;
  onInvalidateCf: () => void;
  /** Nasconde il selettore "Tipo soggetto" (reso esternamente sopra i dati:
   *  vale solo per lo step acquirente). Default: mostrato inline (venditore). */
  hideTipoSoggetto?: boolean;
}) {
  const mostraVisura =
    isPG || tipoSoggetto === 'AZIENDA' || tipoSoggetto === 'OPERATORE_AUTO';
  const mostraPermesso = tipoSoggetto === 'STRANIERO_EXTRA_UE';
  const mostraCodiceFiscale = documentiRichiestiParte({
    isPersonaGiuridica: isPG,
    tipoSoggetto,
    documentoIdentita: docId,
    ciTipo,
  }).codiceFiscale;

  // Upload di un singolo campo su Blob, aggiornando lo slot via `onFiles`. Al
  // termine chiama `afterUpload(ref)` (es. OCR). `onInvalidate` azzera l'OCR
  // collegato sia al cambio file (re-OCR) sia alla rimozione. Se file=null,
  // rimuove lo slot (invalida la ref) e invalida l'OCR.
  const handleField = (
    field: keyof IdentitaFiles,
    file: File | null,
    afterUpload?: (ref: BlobRef) => void,
    onInvalidate?: () => void,
  ) => {
    onInvalidate?.();
    if (!file) {
      onFiles((prev) => ({ ...prev, [field]: undefined }));
      return;
    }
    onFiles((prev) => ({
      ...prev,
      [field]: { ref: null, file, uploading: true, progress: 0, error: null },
    }));
    void uploadToBlob(file, 'pratiche-staging', (pct) => {
      onFiles((prev) => {
        const cur = prev[field];
        if (!cur) return prev;
        return { ...prev, [field]: { ...cur, progress: pct } };
      });
    })
      .then((ref) => {
        onFiles((prev) => ({
          ...prev,
          [field]: { ref, file, uploading: false, progress: 100, error: null },
        }));
        afterUpload?.(ref);
      })
      .catch((err: unknown) => {
        onFiles((prev) => ({
          ...prev,
          [field]: {
            ref: null,
            file,
            uploading: false,
            progress: 0,
            error: (err as Error).message,
          },
        }));
      });
  };

  return (
    <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
      <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">{titolo}</h2>
      {!hideTipoSoggetto && (
        <>
          <Field label="Tipo soggetto" required>
            <Select
              value={tipoSoggetto ?? ''}
              onChange={(e) => onTipoSoggetto(e.target.value as TipoSoggetto)}
            >
              <option value="" disabled>
                Seleziona tipo…
              </option>
              {tipiSoggetto.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="my-3 h-px bg-pv-slate-200" />
        </>
      )}

      <Field label="Tipo documento" required>
        <Select
          value={docId}
          onChange={(e) => onDocId(e.target.value as DocIdTipo)}
        >
          {DOC_ID_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>

      {/* Variante CI: solo per privato + CI. La CIE elettronica contiene il CF
          (nessun documento CF separato); la cartacea no. Default: elettronica. */}
      {tipoSoggetto === 'PRIVATO_ITALIANO' && docId === 'CI' && (
        <Field label="Tipo di carta d'identità" required>
          <Select value={ciTipo} onChange={(e) => onCiTipo(e.target.value as CiTipo)}>
            {CI_TIPO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {docId === 'CI' || docId === 'PATENTE' ? (
          <>
            <UploadCard
              label={docId === 'PATENTE' ? 'Patente (fronte)' : 'Fronte'}
              slot={files.fronte}
              onSelect={(f) => handleField('fronte', f, onMainRef, onInvalidateIdentita)}
              onRemove={() => handleField('fronte', null, onMainRef, onInvalidateIdentita)}
            />
            <UploadCard
              label={docId === 'PATENTE' ? 'Patente (retro)' : 'Retro'}
              slot={files.retro}
              onSelect={(f) => handleField('retro', f)}
              onRemove={() => handleField('retro', null)}
            />
          </>
        ) : (
          <UploadCard
            label="Passaporto"
            slot={files.single}
            onSelect={(f) => handleField('single', f, onMainRef, onInvalidateIdentita)}
            onRemove={() => handleField('single', null, onMainRef, onInvalidateIdentita)}
          />
        )}
      </div>

      {/* Tessera sanitaria / codice fiscale: quando l'identificazione non è CIE
          (CI cartacea, passaporto, patente). Servono fronte + retro. L'OCR del
          fronte alimenta il match fail-closed col CF inserito (validaParte); il
          retro è solo raccolto. */}
      {mostraCodiceFiscale && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UploadCard
            label="Tessera sanitaria / Codice fiscale (fronte)"
            slot={files.codiceFiscale}
            onSelect={(f) => handleField('codiceFiscale', f, onCfRef, onInvalidateCf)}
            onRemove={() => handleField('codiceFiscale', null, onCfRef, onInvalidateCf)}
          />
          <UploadCard
            label="Tessera sanitaria / Codice fiscale (retro)"
            slot={files.codiceFiscaleRetro}
            onSelect={(f) => handleField('codiceFiscaleRetro', f)}
            onRemove={() => handleField('codiceFiscaleRetro', null)}
          />
        </div>
      )}

      {/* Visura camerale: solo per AZIENDA / OPERATORE_AUTO. L'OCR alimenta il
          cross-check denominazione/P.IVA + freschezza ≤6 mesi (validaParte). */}
      {mostraVisura && (
        <div className="mt-3">
          <UploadCard
            label="Visura camerale (se sei una azienda con codice ateco di commercio auto la visura deve essere degli ultimi 6 mesi da oggi)"
            slot={files.visura}
            pdfOnly
            subtitle="La visura camerale deve essere in formato PDF. Scaricala dal Registro Imprese e caricala qui."
            onSelect={(f) => handleField('visura', f, onVisuraRef, onInvalidateVisura)}
            onRemove={() => handleField('visura', null, onVisuraRef, onInvalidateVisura)}
          />
        </div>
      )}

      {/* Permesso di soggiorno: solo per STRANIERO_EXTRA_UE. L'OCR alimenta il
          cross-check nominativo + scadenza valida (validaParte). */}
      {mostraPermesso && (
        <div className="mt-3">
          <UploadCard
            label="Permesso di soggiorno (in corso di validità)"
            slot={files.permesso}
            onSelect={(f) => handleField('permesso', f, onPermessoRef, onInvalidatePermesso)}
            onRemove={() => handleField('permesso', null, onPermessoRef, onInvalidatePermesso)}
          />
        </div>
      )}
    </div>
  );
}

function RiepilogoRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-pv-slate-500">{label}</dt>
      <dd className="font-semibold text-pv-navy-800">{value}</dd>
    </>
  );
}

/** Formato email base (non RFC completo): un token, @, dominio con punto. */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function parteValida(p: Parte): boolean {
  // Schema Documentale v7 (SD-B): tipoSoggetto obbligatorio + anagrafica
  // completa. La validità dei documenti (visura ≤6 mesi, permesso non scaduto)
  // è verificata via OCR nella verifica documentale (lib/kyc/parte-docs).
  if (!p.tipoSoggetto) return false;

  // Contatti obbligatori (telefono + email valida) per ogni parte.
  if (p.telefono.trim().length === 0 || !EMAIL_RE.test(p.email.trim())) return false;

  if (p.isPG) return p.ragioneSociale.trim().length > 0 && p.piva.length === 11;
  return (
    p.nome.trim().length > 0 && p.cognome.trim().length > 0 && p.cf.trim().length === 16
  );
}

/**
 * True se la parte è "completa": anagrafica valida + tutti i documenti richiesti
 * presenti (e nessun upload in corso). Solo allora un verdetto negativo è un
 * errore REALE da mostrare; con campi vuoti o documenti non ancora caricati il
 * controllo fail-closed darebbe falsi positivi già all'atterraggio sullo step.
 */
function parteCompleta(p: Parte, docId: DocIdTipo, identita: IdentitaFiles): boolean {
  if (!parteValida(p)) return false;
  if (identitaUploading(identita)) return false;
  const req = documentiRichiestiParte({
    isPersonaGiuridica: p.isPG,
    tipoSoggetto: p.tipoSoggetto,
    documentoIdentita: docId,
    ciTipo: p.ciTipo,
  });
  if (req.identita && !identitaPresente(docId, identita)) return false;
  if (req.codiceFiscale && (!identita.codiceFiscale?.ref || !identita.codiceFiscaleRetro?.ref))
    return false;
  if (req.visura && !identita.visura?.ref) return false;
  if (req.permesso && !identita.permesso?.ref) return false;
  return true;
}

/** Elenco leggibile dei dati/documenti mancanti di una parte (per il toast). */
function mancanzeParte(p: Parte, docId: DocIdTipo, identita: IdentitaFiles): string[] {
  const m: string[] = [];
  if (!p.tipoSoggetto) m.push('tipo soggetto');
  if (p.isPG) {
    if (!p.ragioneSociale.trim()) m.push('ragione sociale');
    if (p.piva.length !== 11) m.push('P.IVA (11 cifre)');
  } else {
    if (!p.nome.trim()) m.push('nome');
    if (!p.cognome.trim()) m.push('cognome');
    if (p.cf.trim().length !== 16) m.push('codice fiscale (16 caratteri)');
  }
  if (!p.telefono.trim()) m.push('numero di telefono');
  if (!EMAIL_RE.test(p.email.trim())) m.push('email valida');
  const req = documentiRichiestiParte({
    isPersonaGiuridica: p.isPG,
    tipoSoggetto: p.tipoSoggetto,
    documentoIdentita: docId,
    ciTipo: p.ciTipo,
  });
  if (req.identita && !identitaPresente(docId, identita)) m.push("documento d'identità");
  if (req.codiceFiscale && !identita.codiceFiscale?.ref)
    m.push('tessera sanitaria / codice fiscale (fronte)');
  if (req.codiceFiscale && !identita.codiceFiscaleRetro?.ref)
    m.push('tessera sanitaria / codice fiscale (retro)');
  if (req.visura && !identita.visura?.ref) m.push('visura camerale');
  if (req.permesso && !identita.permesso?.ref) m.push('permesso di soggiorno');
  if (identitaUploading(identita)) m.push('caricamento documenti in corso');
  return m;
}

/**
 * Verifica documentale OCR (fail-closed) di una parte: costruisce ParteDati dai
 * campi inseriti e OcrParte dai risultati OCR salvati, poi delega a validaParte
 * (lib/kyc/parte-docs). `ok` solo se ogni documento richiesto è presente e ogni
 * verdetto è MATCH. Stesso modulo puro usato lato server (autoritativo).
 */
function verificaDocumentaleParte(
  p: Parte,
  docId: DocIdTipo,
  now: Date,
  atecoAllowed?: AllowedAteco[],
  richiedeOperatoreAuto?: boolean,
): { ok: boolean; problemi: string[] } {
  const parteDati: ParteDati = {
    isPersonaGiuridica: p.isPG,
    tipoSoggetto: p.tipoSoggetto,
    documentoIdentita: docId,
    nome: p.nome,
    cognome: p.cognome,
    cf: p.cf,
    ragioneSociale: p.ragioneSociale,
    piva: p.piva,
  };
  const ocr: OcrParte = {
    identita: p.identitaOcr,
    visura: p.visuraOcr,
    permesso: p.permessoOcr,
    codiceFiscale: p.codiceFiscaleOcr,
  };
  return validaParte(parteDati, ocr, now, { atecoAllowed, richiedeOperatoreAuto });
}

function parteNome(p: Parte): string {
  if (p.isPG) return p.ragioneSociale || '—';
  return `${p.nome} ${p.cognome}`.trim() || '—';
}

function labelTipo(t: Tipo, multiplo: boolean): string {
  if (t === 'SEMPLICE')
    return multiplo
      ? 'Passaggio di proprietà semplice multiplo'
      : 'Passaggio di proprietà semplice';
  if (t === 'MINIVOLTURA')
    return multiplo ? 'Minivoltura multipla' : 'Minivoltura singola';
  return t;
}

/**
 * Schema Documentale v7 (SD-B): preview live dei documenti richiesti
 * dall'engine puro, mostrato come ultima card del wizard prima del submit.
 * - kind=INPUT_INCOMPLETO → spiega cosa manca compilare (tipo soggetto)
 * - kind=BLOCCO → mostra motivo + soluzione (ostativo)
 * - kind=OK → lista checklist documenti obbligatori, raggruppati per parte
 *   (i documenti veicolo sono raggruppati per veicoloOrdine).
 */
function SchemaDocumentalePreview({
  esito,
}: {
  esito: ReturnType<typeof calcolaDocumentiRichiesti>;
}) {
  if (esito.kind === 'INPUT_INCOMPLETO') {
    return (
      <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
        <h2 className="mb-2 text-[15px] font-bold text-pv-navy-800">
          Documenti richiesti
        </h2>
        <Alert variant="info">
          Per calcolare la lista esatta di documenti, completa il tipo
          soggetto del venditore e dell&apos;acquirente negli step precedenti.
        </Alert>
      </div>
    );
  }

  if (esito.kind === 'BLOCCO') {
    return (
      <div className="rounded-[16px] border border-pv-red-500/40 bg-pv-red-50/40 p-5 shadow-[var(--pv-shadow-card)]">
        <h2 className="mb-2 text-[15px] font-bold text-pv-red-500">
          Pratica bloccata
        </h2>
        <p className="text-[13px] text-pv-navy-800">
          <strong>Motivo:</strong> {esito.motivo}
        </p>
        <p className="mt-2 text-[12.5px] text-pv-slate-700">
          <strong>Come sbloccare:</strong> {esito.soluzione}
        </p>
      </div>
    );
  }

  // Raggruppa per parte; per i doc veicolo distingue per veicoloOrdine.
  const grouped = new Map<string, typeof esito.documentiRichiesti>();
  for (const d of esito.documentiRichiesti) {
    const key =
      d.parte === 'VEICOLO' && d.veicoloOrdine != null
        ? `VEICOLO_${d.veicoloOrdine}`
        : d.parte;
    const list = grouped.get(key) ?? [];
    list.push(d);
    grouped.set(key, list);
  }

  const labelParte: Record<string, string> = {
    VENDITORE: 'Venditore',
    ACQUIRENTE: 'Acquirente',
    PROCURATORE: 'Procuratore',
    EREDE: 'Erede / successione',
    TUTORE: 'Tutore (compratore minorenne)',
    AMMINISTRATORE_VENDITORE: 'Amministratore (venditore)',
    AMMINISTRATORE_ACQUIRENTE: 'Amministratore (acquirente)',
  };

  const labelGroup = (key: string): string => {
    if (key.startsWith('VEICOLO_')) return `Veicolo ${key.slice('VEICOLO_'.length)}`;
    if (key === 'VEICOLO') return 'Veicolo';
    return labelParte[key] ?? key;
  };

  return (
    <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
      <h2 className="mb-1 text-[15px] font-bold text-pv-navy-800">
        Documenti richiesti ({esito.documentiRichiesti.length})
      </h2>
      <p className="mb-3 text-[12px] text-pv-slate-500">
        Calcolati in base alle tue risposte. L&apos;agenzia che accetta deve
        ricevere tutti questi documenti per chiudere la pratica.
      </p>
      <div className="space-y-3">
        {Array.from(grouped.entries()).map(([parte, docs]) => (
          <div key={parte}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              {labelGroup(parte)}
            </p>
            <ul className="mt-1 space-y-1 text-[13px] text-pv-slate-700">
              {docs.map((d, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-pv-navy-700" />
                  <span>{d.motivo}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
