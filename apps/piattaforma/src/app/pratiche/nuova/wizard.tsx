'use client';

import { useState, useTransition, useMemo, useEffect } from 'react';
import { Alert, Button, Checkbox, Field, Input, Select } from '@/components/ui';
import { WizardProgress } from '@/components/wizard-progress';
import { DichiarazionePopup } from '@/components/dichiarazione-popup';
import { RevisioneManualePopup } from '@/components/revisione-manuale-popup';
import { PENALI } from '@/lib/penali/config';
import { docKey, docLabel, requiredUploadDocs } from '@/lib/documenti/richiesti';
import {
  calcolaDocumentiRichiesti,
  type TipoSoggetto,
} from '@/lib/documenti/engine';
import type { LibrettoCircolazioneData } from '@/lib/providers/ocr/types';
import { venditoriCrossCheck } from '@/lib/kyc/match';
import { uploadToBlob, type BlobRef } from '@/lib/blob/upload-client';
import {
  extractLibrettoAction,
  extractIdentitaAction,
  submitNuovaPraticaAction,
} from './actions';

type DocIdTipo = 'CI' | 'PASSAPORTO' | 'PATENTE';

/**
 * Slot di upload diretto su Vercel Blob. Il browser carica il file
 * direttamente su Blob (aggira il limite 4,5 MB sul body delle Server Action)
 * e teniamo in stato solo la BlobRef (il "gettone"). `file` è conservato solo
 * per l'anteprima locale (nome/dimensione/immagine) e NON viene mai inviato al
 * server né alle action OCR. `uploading`/`progress`/`error` guidano la UI.
 */
type BlobSlot = {
  ref: BlobRef | null;
  file: File | null;
  uploading: boolean;
  progress: number;
  error: string | null;
};

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
};

/**
 * Splitta una stringa "Nome Cognome" in due parti.
 * Per nomi composti (es. "Maria Carla Bianchi") l'ultimo token è cognome.
 * Se la stringa è una sola parola, la usiamo come cognome (caso edge).
 */
/**
 * A7: presenza documento d'identità per parte. Per la CI servono ENTRAMBE le
 * facciate (fronte+retro) — coerente con la validazione server-side; per
 * passaporto/patente basta il file singolo. Il permesso è opzionale.
 * "Presente" significa BlobRef caricata (non basta aver scelto il file: serve
 * che l'upload su Blob sia completato).
 */
function identitaPresente(docId: DocIdTipo, files: IdentitaFiles): boolean {
  return docId === 'CI'
    ? !!files.fronte?.ref && !!files.retro?.ref
    : !!files.single?.ref;
}

/** True se un upload identità è ancora in corso (gate). */
function identitaUploading(files: IdentitaFiles): boolean {
  return (
    slotUploading(files.fronte) ||
    slotUploading(files.retro) ||
    slotUploading(files.single) ||
    slotUploading(files.permesso)
  );
}

function splitNomeCompleto(full: string): { nome: string; cognome: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { nome: '', cognome: parts[0] ?? '' };
  const cognome = parts[parts.length - 1]!;
  const nome = parts.slice(0, -1).join(' ');
  return { nome, cognome };
}

const STEPS = [
  { id: 1, label: 'Tipo & veicoli', title: 'Tipo pratica e veicoli', hint: 'Scegli il tipo di pratica e carica i libretti di circolazione.' },
  { id: 2, label: 'Venditore', title: 'Venditore', hint: 'Dati del venditore e documento d\'identità + eventuali flag speciali.' },
  { id: 3, label: 'Acquirente', title: 'Acquirente', hint: 'Dati dell\'acquirente e documento d\'identità.' },
  { id: 4, label: 'Documenti', title: 'Documenti richiesti', hint: 'Carica i documenti richiesti. La firma avviene in agenzia con gli originali.' },
  { id: 5, label: 'Invio', title: 'Localizzazione e invio', hint: 'Comune di riferimento e riepilogo finale.' },
] as const;

type Tipo = 'SEMPLICE' | 'MINIVOLTURA';

/** Dati di un singolo veicolo nel wizard (libretto + estrazione + correzioni). */
type VeicoloInput = {
  /** BlobRef del libretto caricato su Blob (slot LIBRETTO_<n> al submit). */
  libretto: BlobSlot;
  fileName: string | null;
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
};

function emptyVeicolo(): VeicoloInput {
  return {
    libretto: emptySlot(),
    fileName: null,
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
  /** Solo per AZIENDA / OPERATORE_AUTO: data rilascio visura (YYYY-MM-DD). */
  visuraData: string;
  /** Solo per STRANIERO_EXTRA_UE: data scadenza permesso (YYYY-MM-DD). */
  permessoData: string;
  nome: string;
  cognome: string;
  cf: string;
  ragioneSociale: string;
  piva: string;
  telefono: string;
  email: string;
};

const emptyParte = (): Parte => ({
  isPG: false,
  tipoSoggetto: null,
  visuraData: '',
  permessoData: '',
  nome: '',
  cognome: '',
  cf: '',
  ragioneSociale: '',
  piva: '',
  telefono: '',
  email: '',
});

/**
 * Tipi pratica multi-veicolo (B6): un venditore (co-intestatario) ha gli stessi
 * campi di una Parte + il proprio documento d'identità (tipo + file). Quando il
 * libretto ha più proprietari, si crea un VenditoreInput per ciascuno.
 */
type VenditoreInput = Parte & {
  docId: DocIdTipo;
  identita: IdentitaFiles;
};

const emptyVenditore = (): VenditoreInput => ({
  ...emptyParte(),
  docId: 'CI',
  identita: {},
});

const TIPI_SOGGETTO_VENDITORE: { value: TipoSoggetto; label: string }[] = [
  { value: 'PRIVATO_ITALIANO_CIE', label: 'Privato italiano · CIE elettronica' },
  { value: 'PRIVATO_ITALIANO_CARTACEA', label: 'Privato italiano · CI cartacea' },
  { value: 'STRANIERO_EXTRA_UE', label: 'Straniero extra-UE' },
  { value: 'AZIENDA', label: 'Azienda / Società' },
  { value: 'OPERATORE_AUTO', label: 'Operatore auto / Commerciante' },
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
    descrizione: 'chi acquista è un privato',
  },
  {
    key: 'SEMPLICE_MULTIPLO',
    tipo: 'SEMPLICE',
    multiplo: true,
    label: 'Passaggio di proprietà semplice multiplo',
    descrizione: 'chi acquista è un privato',
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

export function WizardNuovaPratica({ error }: { error?: string }) {
  const [step, setStep] = useState(1);
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
  };

  const handleCardSelect = (card: (typeof TIPO_CARDS)[number]) => {
    setTipo(card.tipo);
    setMultiplo(card.multiplo);
    changeNumeroVeicoli(card.multiplo ? 2 : 1);
    // Se il nuovo tipo non è MINIVOLTURA, l'acquirente deve poter scegliere un
    // tipo soggetto valido per SEMPLICE; resettiamo se era OPERATORE_AUTO.
    if (card.tipo !== 'MINIVOLTURA') {
      setAcquirente((prev) =>
        prev.tipoSoggetto === 'OPERATORE_AUTO'
          ? { ...prev, tipoSoggetto: null, isPG: false, visuraData: '' }
          : prev,
      );
    } else {
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
  const [acquirente, setAcquirente] = useState<Parte>(emptyParte());

  // Aggiorna un singolo venditore per indice (update immutabile).
  const updateVenditore = (idx: number, patch: Partial<VenditoreInput>) => {
    setVenditori((prev) => prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  };
  const addVenditore = () => setVenditori((prev) => [...prev, emptyVenditore()]);
  const removeVenditore = (idx: number) =>
    setVenditori((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));

  // Documento d'identità per parte (A7): tipo scelto + file caricati. Il file
  // principale (fronte CI / single passaporto-patente) avvia l'OCR di pre-fill.
  const [acquirenteDocId, setAcquirenteDocId] = useState<DocIdTipo>('CI');
  const [acquirenteIdentita, setAcquirenteIdentita] = useState<IdentitaFiles>({});

  const [flagCointestazione, setFlagCointestazione] = useState(false);
  const [flagMinivoltura, setFlagMinivoltura] = useState(false);
  const [flagProcura, setFlagProcura] = useState(false);
  // Schema Documentale v7 (SD-B): casi speciali aggiuntivi
  const [flagSuccessione, setFlagSuccessione] = useState(false);
  const [flagMinore, setFlagMinore] = useState(false);

  const [comune, setComune] = useState('');
  const [provincia, setProvincia] = useState('');

  // Step Documenti: BlobRef caricate per documento richiesto (chiave = docKey).
  const [documenti, setDocumenti] = useState<Record<string, BlobSlot>>({});

  const acquirenteTipiSoggetto =
    tipo === 'MINIVOLTURA'
      ? TIPI_SOGGETTO_ACQUIRENTE_MINIVOLTURA
      : TIPI_SOGGETTO_ACQUIRENTE_SEMPLICE;

  // B6: auto-popola i venditori dai proprietari estratti dal primo libretto.
  // - Se il libretto ha N proprietari (co-intestatari), crea un VenditoreInput
  //   per ciascuno (split best-effort del nominativo MAIUSCOLO in cognome+nome).
  // - Non sovrascrive dati già inseriti: agisce solo se i venditori sono ancora
  //   al default (uno solo, vuoto). L'utente può poi aggiungere/correggere.
  // Chiamato post-estrazione del veicolo 1 (no effect → evita cascading render).
  const maybePrefillVenditori = (data: LibrettoCircolazioneData) => {
    const proprietari =
      data.proprietari && data.proprietari.length > 0
        ? data.proprietari
        : data.proprietarioAttuale
          ? [data.proprietarioAttuale]
          : [];
    if (!proprietari.length) return;
    setVenditori((prev) => {
      // Solo se l'utente non ha ancora toccato nulla (un venditore vuoto).
      const isDefault =
        prev.length === 1 &&
        !prev[0]!.isPG &&
        !prev[0]!.nome.trim() &&
        !prev[0]!.cognome.trim() &&
        !prev[0]!.ragioneSociale.trim();
      if (!isDefault) return prev;
      // Un solo proprietario: pre-fill il venditore esistente (preserva docId/file).
      if (proprietari.length === 1) {
        const { nome, cognome } = splitNomeCompleto(proprietari[0]!);
        if (!nome && !cognome) return prev;
        return [{ ...prev[0]!, nome, cognome }];
      }
      // Più proprietari: un venditore per ciascuno.
      return proprietari.map((p) => {
        const { nome, cognome } = splitNomeCompleto(p);
        return { ...emptyVenditore(), nome, cognome };
      });
    });
  };

  const [submitting, startSubmit] = useTransition();

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
        visuraData: v.visuraData ? new Date(v.visuraData) : null,
        permessoData: v.permessoData ? new Date(v.permessoData) : null,
      })),
      flagProcura,
      flagSuccessione,
      acquirenteTipoSoggetto: acquirente.tipoSoggetto,
      acquirenteVisuraData: acquirente.visuraData
        ? new Date(acquirente.visuraData)
        : null,
      acquirentePermessoData: acquirente.permessoData
        ? new Date(acquirente.permessoData)
        : null,
      acquirenteDocumentoIdentita: acquirenteDocId,
      flagMinore,
    });
  }, [
    veicoli,
    venditori,
    flagProcura,
    flagSuccessione,
    acquirente.tipoSoggetto,
    acquirente.visuraData,
    acquirente.permessoData,
    acquirenteDocId,
    flagMinore,
  ]);

  // Upload del libretto su Blob (client upload) → poi OCR sulla BlobRef. Lo
  // stato del veicolo tiene lo slot (ref/progress/error) + l'estrazione. Se
  // l'upload fallisce, niente OCR (mostra l'errore sul libretto). Se cambia il
  // file, invalida anche l'OCR precedente.
  const onFileSelected = async (idx: number, file: File | undefined) => {
    if (!file) return;
    // Reset stato veicolo: nuovo libretto in caricamento + OCR azzerato.
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
        libretto: {
          ref: null,
          file,
          uploading: false,
          progress: 0,
          error: (err as Error).message,
        },
      });
      return;
    }
    // Upload OK: salva la ref e avvia l'estrazione OCR sulla BlobRef.
    updateVeicolo(idx, {
      libretto: { ref, file, uploading: false, progress: 100, error: null },
      extracting: true,
    });
    try {
      const res = await extractLibrettoAction(ref);
      if (res.ok) {
        updateVeicolo(idx, {
          extracting: false,
          ocr: res.data,
          targa: res.data.targa ?? '',
          telaio: res.data.telaio ?? '',
          proprietarioAttuale: res.data.proprietarioAttuale ?? '',
          dataImmatricolazione: res.data.dataImmatricolazione ?? '',
          preImm2015: res.data.preImm2015,
          flagComodatoDuso: res.data.flagComodatoDuso,
        });
        // Pre-fill venditori solo dai proprietari del primo veicolo.
        if (idx === 0) maybePrefillVenditori(res.data);
      } else {
        updateVeicolo(idx, { extracting: false, ocrError: res.error });
      }
    } catch (err) {
      updateVeicolo(idx, {
        extracting: false,
        ocrError: (err as Error).message,
      });
    }
  };

  // A7: OCR del documento d'identità → pre-fill nome/cognome/CF della parte.
  // Chiamato quando la BlobRef del file principale (fronte CI o single) è
  // pronta. Non sovrascrive campi già compilati a mano dal broker.
  const runIdentitaOcr = async <P extends Parte>(
    ref: BlobRef,
    tipo: DocIdTipo,
    onChange: (updater: (p: P) => P) => void,
  ) => {
    try {
      const res = await extractIdentitaAction(ref, tipo);
      if (!res.ok) return;
      const { nome, cognome, codiceFiscale } = res.data;
      onChange((prev) => {
        if (prev.isPG) return prev;
        return {
          ...prev,
          nome: prev.nome.trim() ? prev.nome : nome ?? prev.nome,
          cognome: prev.cognome.trim() ? prev.cognome : cognome ?? prev.cognome,
          cf: prev.cf.trim() ? prev.cf : (codiceFiscale ?? prev.cf).toUpperCase(),
        };
      });
    } catch {
      // best-effort: il broker può sempre compilare a mano
    }
  };

  const handleFinalSubmit = () => {
    // Tutti i libretti devono avere la BlobRef pronta (nessun upload a metà).
    if (veicoli.some((v) => !v.libretto.ref)) return;
    const fd = new FormData();
    fd.append('tipo', tipo);
    fd.append('numeroVeicoli', String(numeroVeicoli));

    // Mappa slot → BlobRef: i file sono già su Blob (client upload), alla
    // Server Action passa SOLO le chiavi (BlobRef) in un unico campo JSON.
    const blobRefs: Record<string, BlobRef> = {};

    // Lista veicoli (JSON). I libretti vanno negli slot LIBRETTO_1..LIBRETTO_n.
    const veicoliPayload = veicoli.map((v) => ({
      targa: v.targa,
      telaio: v.telaio,
      proprietarioAttuale: v.proprietarioAttuale,
      dataImmatricolazione: v.dataImmatricolazione || null,
      preImm2015: v.preImm2015,
      flagComodatoDuso: v.flagComodatoDuso,
      ocrData: v.ocr ?? null,
    }));
    fd.append('veicoli', JSON.stringify(veicoliPayload));
    veicoli.forEach((v, i) => {
      if (v.libretto.ref) blobRefs[`LIBRETTO_${i + 1}`] = v.libretto.ref;
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
      isPG: v.isPG,
      tipoSoggetto: v.tipoSoggetto,
      visuraData: v.visuraData || null,
      permessoData: v.permessoData || null,
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

    // Documenti richiesti (step Documenti) come slot DOC__<docKey> (BlobRef).
    for (const [key, slot] of Object.entries(documenti)) {
      if (slot.ref) blobRefs[`DOC__${key}`] = slot.ref;
    }

    fd.append('flagCointestazione', flagCointestazione ? 'true' : 'false');
    fd.append('flagMinivoltura', flagMinivoltura ? 'true' : 'false');
    fd.append('flagProcura', flagProcura ? 'true' : 'false');
    fd.append('flagSuccessione', flagSuccessione ? 'true' : 'false');
    fd.append('flagMinore', flagMinore ? 'true' : 'false');

    // Schema Documentale v7 (SD-B): tipo soggetto + date validità acquirente.
    // (Per i venditori questi campi sono nel JSON `venditori` qui sopra.)
    if (acquirente.tipoSoggetto) {
      fd.append('acquirenteTipoSoggetto', acquirente.tipoSoggetto);
    }
    if (acquirente.visuraData) fd.append('acquirenteVisuraData', acquirente.visuraData);
    if (acquirente.permessoData) fd.append('acquirentePermessoData', acquirente.permessoData);

    // B6: documento d'identità PER venditore negli slot VEND<n>_* (BlobRef). Il
    // tipo documento (docId) viaggia nel JSON `venditori`.
    venditori.forEach((v, i) => {
      const n = i + 1;
      if (v.docId === 'CI') {
        if (v.identita.fronte?.ref) blobRefs[`VEND${n}_ID_FRONTE`] = v.identita.fronte.ref;
        if (v.identita.retro?.ref) blobRefs[`VEND${n}_ID_RETRO`] = v.identita.retro.ref;
      } else if (v.identita.single?.ref) {
        blobRefs[`VEND${n}_ID`] = v.identita.single.ref;
      }
      if (v.identita.permesso?.ref) blobRefs[`VEND${n}_PERMESSO`] = v.identita.permesso.ref;
    });

    // A7: documento d'identità acquirente (tipo + slot BlobRef).
    fd.append('acquirenteDocumentoIdentita', acquirenteDocId);
    if (acquirenteDocId === 'CI') {
      if (acquirenteIdentita.fronte?.ref) blobRefs['ACQ_ID_FRONTE'] = acquirenteIdentita.fronte.ref;
      if (acquirenteIdentita.retro?.ref) blobRefs['ACQ_ID_RETRO'] = acquirenteIdentita.retro.ref;
    } else if (acquirenteIdentita.single?.ref) {
      blobRefs['ACQ_ID'] = acquirenteIdentita.single.ref;
    }
    if (acquirenteIdentita.permesso?.ref) blobRefs['ACQ_PERMESSO'] = acquirenteIdentita.permesso.ref;

    // Unico campo FormData con la mappa slot → BlobRef (niente File nel body).
    fd.append('blobRefs', JSON.stringify(blobRefs));

    fd.append('comune', comune);
    fd.append('provincia', provincia);

    // Sistema Penali Broker: payload di accettazione popup (versione + flag)
    fd.append('dichiarazioneAccettata', 'true');
    fd.append('dichiarazionePopupVersion', PENALI.POPUP_VERSION);

    startSubmit(async () => {
      await submitNuovaPraticaAction(fd);
    });
  };

  const current = STEPS.find((s) => s.id === step)!;

  // Tutti i veicoli devono avere il libretto caricato (BlobRef) + campi
  // obbligatori (targa/telaio/proprietario/data) prima di proseguire. Nessun
  // upload del libretto deve essere ancora in corso.
  const librettiUploading = veicoli.some((v) => v.libretto.uploading);
  const veicoliValidi =
    veicoli.length === numeroVeicoli &&
    veicoli.every(
      (v) =>
        !!v.libretto.ref &&
        v.targa.length >= 5 &&
        v.telaio.length >= 11 &&
        v.proprietarioAttuale.length > 0 &&
        /^\d{4}-\d{2}-\d{2}$/.test(v.dataImmatricolazione),
    );
  const comodatoBloccante = veicoli.some((v) => v.flagComodatoDuso);
  // Gate per lasciare lo step 1 (Tipo & veicoli).
  const canStep1 = veicoliValidi && !comodatoBloccante && !librettiUploading;

  // B6: cross-check insiemistico venditori ↔ proprietari del primo libretto.
  // I proprietari sono tutti gli intestatari estratti dall'OCR (co-intestatari),
  // con fallback al proprietarioAttuale (campo editabile) se la lista è vuota.
  const proprietari =
    veicoli[0]?.ocr?.proprietari ??
    (veicoli[0]?.proprietarioAttuale ? [veicoli[0].proprietarioAttuale] : []);
  const ccVend = venditoriCrossCheck(
    venditori.map((v) => ({
      isPersonaGiuridica: v.isPG,
      nome: v.nome,
      cognome: v.cognome,
      ragioneSociale: v.ragioneSociale,
    })),
    proprietari,
    { flagProcura },
  );

  // Gate per lasciare lo step 2 (Venditore): ogni venditore valido + identità
  // presente (BlobRef) + nessun upload in corso + nessun mismatch insiemistico.
  const canStep2 =
    venditori.every(
      (v) =>
        parteValida(v) &&
        identitaPresente(v.docId, v.identita) &&
        !identitaUploading(v.identita),
    ) && ccVend !== 'MISMATCH';

  // Gate per lasciare lo step 3 (Acquirente): parte valida + identità (BlobRef)
  // pronta + nessun upload in corso.
  const canStep3 =
    parteValida(acquirente) &&
    identitaPresente(acquirenteDocId, acquirenteIdentita) &&
    !identitaUploading(acquirenteIdentita);

  // Step Documenti: tutti i documenti richiesti (esclusi i libretti) devono
  // avere la BlobRef caricata + nessun upload in corso, prima di proseguire.
  const docsUploading = Object.values(documenti).some((s) => s.uploading);
  const docsValidi =
    esitoSchema.kind === 'OK' &&
    requiredUploadDocs(esitoSchema).every((d) => !!documenti[docKey(d)]?.ref) &&
    !docsUploading;

  // Schema Documentale v7 (SD-B): blocca il submit se l'engine non torna OK
  // (BLOCCO o INPUT_INCOMPLETO). Lo step 3 mostra l'esito tramite
  // SchemaDocumentalePreview così il broker capisce cosa correggere.
  const canSubmit =
    comune.trim().length > 0 &&
    /^[A-Za-z]{2}$/.test(provincia.trim()) &&
    esitoSchema.kind === 'OK';

  return (
    <>
      <WizardProgress steps={STEPS} current={step} label="Nuova pratica" />
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            {current.title}
          </h1>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-pv-slate-500">
            {current.hint}
          </p>
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
                Tipo pratica
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
                      className={`rounded-[12px] border-[1.5px] p-4 text-left transition ${
                        selected
                          ? 'border-pv-navy-700 bg-pv-navy-50 shadow-[var(--pv-shadow-card)]'
                          : 'border-pv-slate-200 bg-white hover:border-pv-navy-400'
                      }`}
                    >
                      <span className="block text-[14px] font-bold text-pv-navy-900">
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
                    <Input
                      type="number"
                      min={2}
                      max={50}
                      value={numeroVeicoli}
                      onChange={(e) =>
                        changeNumeroVeicoli(Math.max(2, Number(e.target.value) || 2))
                      }
                    />
                  </Field>
                  <p className="mt-1 text-[12px] text-pv-slate-500">
                    Le pratiche multiple richiedono da 2 a 50 veicoli.
                  </p>
                </div>
              )}
            </div>

            {veicoli.map((v, idx) => (
              <VeicoloSection
                key={idx}
                ordine={idx + 1}
                veicolo={v}
                multiplo={multiplo}
                onFile={(file) => onFileSelected(idx, file)}
                onChange={(patch) => updateVeicolo(idx, patch)}
                onManuale={() =>
                  updateVeicolo(idx, {
                    ocr: undefined,
                    ocrManuale: true,
                    ocrError: null,
                    targa: '',
                    telaio: '',
                    proprietarioAttuale: '',
                    dataImmatricolazione: '',
                    preImm2015: false,
                    flagComodatoDuso: false,
                  })
                }
              />
            ))}

            {comodatoBloccante && (
              <Alert variant="error">
                Uno o più veicoli risultano in comodato d&apos;uso: rimuovi il comodato in agenzia prima di poter procedere.
              </Alert>
            )}
            <div className="flex justify-end">
              <Button disabled={!canStep1} onClick={() => setStep(2)}>
                Avanti
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            {ccVend === 'MISMATCH' && (
              <Alert variant="error">
                I venditori non corrispondono agli intestatari del libretto
                {proprietari.length > 0 && <> ({proprietari.join(', ')})</>}.
                Verifica i nominativi o aggiungi i co-intestatari mancanti.
              </Alert>
            )}

            {venditori.map((v, idx) => (
              <div key={idx} className="space-y-5">
                <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-[15px] font-bold text-pv-navy-800">
                      {venditori.length > 1 ? `Venditore ${idx + 1}` : 'Venditore'}
                    </h2>
                    {venditori.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeVenditore(idx)}
                        className="text-[12.5px] font-semibold text-pv-red-500 underline hover:text-pv-red-600"
                      >
                        Rimuovi
                      </button>
                    )}
                  </div>
                  <ParteForm
                    parte={v}
                    onChange={(p) => updateVenditore(idx, p)}
                    tipiSoggetto={TIPI_SOGGETTO_VENDITORE}
                  />
                </div>

                <IdentitaSection
                  titolo={
                    venditori.length > 1
                      ? `Documento d'identità del venditore ${idx + 1}`
                      : "Documento d'identità del venditore"
                  }
                  docId={v.docId}
                  onDocId={(t) => updateVenditore(idx, { docId: t })}
                  files={v.identita}
                  onFiles={(updater) =>
                    setVenditori((prev) =>
                      prev.map((vv, i) =>
                        i === idx ? { ...vv, identita: updater(vv.identita) } : vv,
                      ),
                    )
                  }
                  onMainRef={(ref) =>
                    runIdentitaOcr<VenditoreInput>(ref, v.docId, (upd) =>
                      setVenditori((prev) =>
                        prev.map((vv, i) => (i === idx ? upd(vv) : vv)),
                      ),
                    )
                  }
                />
              </div>
            ))}

            <div className="flex justify-start">
              <Button variant="secondary" onClick={addVenditore}>
                + Aggiungi venditore (co-intestatario)
              </Button>
            </div>

            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">Flag pratica</h2>
              <p className="mb-3 text-[12px] text-pv-slate-500">
                Spunta quelli applicabili: ogni flag aggiunge documenti
                richiesti specifici (es. procura → atto procuratore + CI).
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-[13px] text-pv-slate-700">
                  <Checkbox
                    checked={flagCointestazione}
                    onChange={(e) => setFlagCointestazione(e.target.checked)}
                  />
                  Cointestazione
                </label>
                <label className="flex items-center gap-2 text-[13px] text-pv-slate-700">
                  <Checkbox
                    checked={flagMinivoltura}
                    onChange={(e) => setFlagMinivoltura(e.target.checked)}
                  />
                  Minivoltura
                </label>
                <label className="flex items-center gap-2 text-[13px] text-pv-slate-700">
                  <Checkbox
                    checked={flagProcura}
                    onChange={(e) => setFlagProcura(e.target.checked)}
                  />
                  Vendita tramite procuratore
                </label>
                <label className="flex items-center gap-2 text-[13px] text-pv-slate-700">
                  <Checkbox
                    checked={flagSuccessione}
                    onChange={(e) => setFlagSuccessione(e.target.checked)}
                  />
                  Veicolo da successione ereditaria
                </label>
                <label className="flex items-center gap-2 text-[13px] text-pv-slate-700">
                  <Checkbox
                    checked={flagMinore}
                    onChange={(e) => setFlagMinore(e.target.checked)}
                  />
                  Compratore minorenne (richiede tutore)
                </label>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button variant="secondary" onClick={() => setStep(1)}>
                Indietro
              </Button>
              <Button disabled={!canStep2} onClick={() => setStep(3)}>
                Avanti
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">Acquirente</h2>
              {tipo === 'MINIVOLTURA' && (
                <p className="mb-3 text-[12px] text-pv-slate-500">
                  Nelle minivolture l&apos;acquirente è un commerciante d&apos;auto
                  (operatore auto), con visura camerale.
                </p>
              )}
              <ParteForm
                parte={acquirente}
                onChange={setAcquirente}
                tipiSoggetto={acquirenteTipiSoggetto}
              />
            </div>

            <IdentitaSection
              titolo="Documento d'identità dell'acquirente"
              docId={acquirenteDocId}
              onDocId={setAcquirenteDocId}
              files={acquirenteIdentita}
              onFiles={setAcquirenteIdentita}
              onMainRef={(ref) =>
                runIdentitaOcr(ref, acquirenteDocId, (updater) =>
                  setAcquirente((prev) => updater(prev)),
                )
              }
            />

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button variant="secondary" onClick={() => setStep(2)}>
                Indietro
              </Button>
              <Button disabled={!canStep3} onClick={() => setStep(4)}>
                Avanti
              </Button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <Alert variant="info">
              Ricorda: tutti i documenti richiesti vanno portati in originale,
              fisicamente in agenzia, al momento della firma.
            </Alert>

            {esitoSchema.kind === 'BLOCCO' && (
              <Alert variant="error">
                <strong>Motivo:</strong> {esitoSchema.motivo}
                <br />
                <strong>Come sbloccare:</strong> {esitoSchema.soluzione}
              </Alert>
            )}

            {esitoSchema.kind === 'INPUT_INCOMPLETO' && (
              <Alert variant="warning">
                Completa i dati delle parti per calcolare i documenti richiesti.
              </Alert>
            )}

            {esitoSchema.kind === 'OK' &&
              (() => {
                const docs = requiredUploadDocs(esitoSchema);
                const caricati = docs.filter((d) => documenti[docKey(d)]?.ref).length;
                return (
                  <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
                    <p className="mb-3 text-[12px] font-semibold text-pv-slate-600">
                      {caricati}/{docs.length} documenti caricati
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {docs.map((d) => {
                        const k = docKey(d);
                        return (
                          <UploadCard
                            key={k}
                            label={docLabel(d)}
                            slot={documenti[k]}
                            onSelect={(file) => uploadDocumento(k, file)}
                            onRemove={() =>
                              setDocumenti((m) => {
                                const n = { ...m };
                                delete n[k];
                                return n;
                              })
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button variant="secondary" onClick={() => setStep(3)}>
                Indietro
              </Button>
              <Button disabled={!docsValidi} onClick={() => setStep(5)}>
                Avanti
              </Button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-5">
            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">Localizzazione</h2>
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

            {/* SD-C: il broker può richiedere revisione manuale del team
                anche se l'engine è BLOCCO o se la situazione non è coperta. */}
            <div className="rounded-[12px] border border-pv-slate-200 bg-pv-slate-50 p-4 text-[12.5px] text-pv-slate-700">
              <p className="font-semibold text-pv-navy-800">
                Non trovi la tua situazione qui sopra?
              </p>
              <p className="mt-1">
                Possiamo analizzarla manualmente e darti istruzioni precise
                entro 24-48h.
              </p>
              <button
                type="button"
                onClick={() => setShowRevisione(true)}
                className="mt-2 text-[12.5px] font-semibold text-pv-navy-700 underline hover:text-pv-navy-800"
              >
                Richiedi revisione manuale →
              </button>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button variant="secondary" onClick={() => setStep(4)} disabled={submitting}>
                Indietro
              </Button>
              <Button
                onClick={() => {
                  setDichiarazioneAccettata(false);
                  setShowDichiarazione(true);
                }}
                disabled={!canSubmit || submitting}
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
 * Sezione veicolo ripetuta: upload libretto → estrazione OCR → campi
 * editabili. Una istanza per veicolo (ordine 1..n).
 */
function VeicoloSection({
  ordine,
  veicolo,
  multiplo,
  onFile,
  onChange,
  onManuale,
}: {
  ordine: number;
  veicolo: VeicoloInput;
  multiplo: boolean;
  onFile: (file: File | undefined) => void;
  onChange: (patch: Partial<VeicoloInput>) => void;
  onManuale: () => void;
}) {
  const hasOcr = !!veicolo.ocr || veicolo.ocrManuale;
  const lib = veicolo.libretto;
  return (
    <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
      <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">
        {multiplo ? `Veicolo ${ordine}` : 'Veicolo'}
      </h2>
      {veicolo.flagComodatoDuso && (
        <div className="mb-4">
          <Alert variant="error">
            Veicolo in comodato d&apos;uso: è obbligatorio recarsi in agenzia per farlo revocare prima di procedere. Non è possibile creare la pratica con un veicolo in comodato.
          </Alert>
        </div>
      )}
      <Field label="Libretto di circolazione (PDF/JPG/PNG)" required>
        <div className="flex flex-col gap-2 rounded-[10px] border-[1.5px] border-dashed border-pv-slate-300 bg-pv-slate-50 px-4 py-3 text-[13px] sm:flex-row sm:items-center sm:justify-between">
          <span className="truncate text-pv-slate-700">
            {veicolo.fileName ?? 'Seleziona file o scatta una foto del libretto'}
          </span>
          <div className="flex shrink-0 gap-2">
            {/* Desktop / file picker classico (PDF/JPG/PNG) */}
            <label className="cursor-pointer rounded-[8px] bg-pv-navy-700 px-3 py-1.5 font-semibold text-white hover:bg-pv-navy-800">
              {veicolo.fileName ? 'Cambia' : 'Sfoglia'}
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(e) => onFile(e.target.files?.[0])}
                className="sr-only"
              />
            </label>
            {/* Q-11: scansione mobile — capture forza la fotocamera
                sui browser mobile, su desktop fa fallback al picker. */}
            <label className="cursor-pointer rounded-[8px] border border-pv-navy-700 bg-white px-3 py-1.5 font-semibold text-pv-navy-700 hover:bg-pv-slate-50">
              Scansiona
              <input
                type="file"
                accept="image/jpeg,image/png"
                capture="environment"
                onChange={(e) => onFile(e.target.files?.[0])}
                className="sr-only"
              />
            </label>
          </div>
        </div>
      </Field>

      {/* Stato upload del libretto su Blob (prima dell'OCR). */}
      {lib.uploading && (
        <p className="mt-2 text-[12px] font-semibold text-pv-navy-700" role="status" aria-live="polite">
          Caricamento libretto… {lib.progress}%
        </p>
      )}
      {!lib.uploading && lib.ref && (
        <p className="mt-2 text-[12px] font-semibold text-pv-green-500">✓ Libretto caricato</p>
      )}
      {lib.error && (
        <div className="mt-2">
          <Alert variant="error">{lib.error}</Alert>
        </div>
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
              L’OCR analizza il libretto: l’operazione può richiedere fino a 30-60 secondi.
              Non chiudere la pagina.
            </p>
          </div>
        </div>
      )}
      {veicolo.ocrError && (
        <div className="mt-3 space-y-3">
          <Alert variant="error">{veicolo.ocrError}</Alert>
          {!veicolo.ocr && !veicolo.ocrManuale && (
            <Button type="button" variant="secondary" onClick={onManuale}>
              Inserisci i dati manualmente
            </Button>
          )}
        </div>
      )}

      {hasOcr && (
        <div className="mt-4 rounded-[12px] border border-pv-slate-200 bg-pv-slate-50 p-4">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Dati estratti — correggi se serve
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
              <label className="flex items-center gap-2 text-[13px] text-pv-slate-700">
                <Checkbox
                  checked={veicolo.flagComodatoDuso}
                  disabled={veicolo.ocr?.flagComodatoDuso === true}
                  onChange={(e) =>
                    onChange({ flagComodatoDuso: e.target.checked })
                  }
                />
                Comodato d&apos;uso rilevato
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ParteForm({
  parte,
  onChange,
  tipiSoggetto,
}: {
  parte: Parte;
  onChange: (p: Parte) => void;
  tipiSoggetto: { value: TipoSoggetto; label: string }[];
}) {
  // Schema Documentale v7 (SD-B): il select tipoSoggetto guida i campi
  // condizionali (data visura per AZIENDA/OPERATORE_AUTO, data permesso
  // per STRANIERO_EXTRA_UE) e popola in cascata isPG e isPersonaGiuridica
  // per backward compatibility con la rotta esistente.
  const handleTipoSoggetto = (next: TipoSoggetto): void => {
    const isPG = next === 'AZIENDA' || next === 'OPERATORE_AUTO';
    onChange({
      ...parte,
      tipoSoggetto: next,
      isPG,
      // Reset le date se il nuovo tipo non le usa
      visuraData: isPG ? parte.visuraData : '',
      permessoData: next === 'STRANIERO_EXTRA_UE' ? parte.permessoData : '',
    });
  };

  return (
    <div>
      <Field label="Tipo soggetto" required>
        <Select
          value={parte.tipoSoggetto ?? ''}
          onChange={(e) =>
            handleTipoSoggetto(e.target.value as TipoSoggetto)
          }
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

      {parte.tipoSoggetto === 'STRANIERO_EXTRA_UE' && (
        <Field
          label="Data scadenza permesso di soggiorno"
          required
          hint="Il permesso deve essere ancora valido alla data di invio"
          className="mt-3"
        >
          <Input
            type="date"
            value={parte.permessoData}
            onChange={(e) =>
              onChange({ ...parte, permessoData: e.target.value })
            }
          />
        </Field>
      )}

      {(parte.tipoSoggetto === 'AZIENDA' ||
        parte.tipoSoggetto === 'OPERATORE_AUTO') && (
        <Field
          label="Data rilascio visura camerale"
          required
          hint="La visura deve essere rilasciata negli ultimi 6 mesi"
          className="mt-3"
        >
          <Input
            type="date"
            value={parte.visuraData}
            onChange={(e) =>
              onChange({ ...parte, visuraData: e.target.value })
            }
          />
        </Field>
      )}

      <div className="my-3 h-px bg-pv-slate-200" />
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
        <Field label="Telefono">
          <Input
            type="tel"
            value={parte.telefono}
            onChange={(e) => onChange({ ...parte, telefono: e.target.value })}
            placeholder="+39 333 1234567"
          />
        </Field>
        <Field label="Email">
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
 * Card di upload diretto su Blob con stato per-file. Sostituisce DocCard negli
 * slot del wizard che vanno su Blob (documenti richiesti, identità): mostra
 * anteprima locale + badge stato (Caricamento N% / ✓ caricato / errore) e
 * delega upload+rimozione al chiamante. NON tiene il File in stato di submit:
 * l'anteprima usa il File solo localmente.
 */
function UploadCard({
  label,
  slot,
  onSelect,
  onRemove,
  invalid = false,
}: {
  label: string;
  slot: BlobSlot | undefined;
  onSelect: (file: File | null) => void;
  onRemove: () => void;
  invalid?: boolean;
}) {
  const file = slot?.file ?? null;
  const inputId = `upload-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  const previewUrl = useMemo(
    () => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const isPdf = file?.type === 'application/pdf';
  const caricato = !!slot?.ref && !slot.uploading;
  const uploading = !!slot?.uploading;
  const erroreUpload = slot?.error ?? null;

  return (
    <div
      className={`rounded-xl border p-4 transition ${
        invalid || erroreUpload
          ? 'border-pv-red-500 bg-pv-red-50'
          : caricato
            ? 'border-pv-green-500/40 bg-pv-green-50'
            : 'border-pv-slate-200 bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-pv-navy-900">{label}</span>
        {uploading ? (
          <span className="rounded-full bg-pv-navy-50 px-2 py-0.5 text-[11px] font-semibold text-pv-navy-700">
            Caricamento… {slot?.progress ?? 0}%
          </span>
        ) : caricato ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-pv-green-500/10 px-2 py-0.5 text-[11px] font-semibold text-pv-green-500">
            ✓ Caricato
          </span>
        ) : (
          <span className="rounded-full bg-pv-slate-100 px-2 py-0.5 text-[11px] font-semibold text-pv-slate-500">
            Da caricare
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-pv-slate-200 bg-pv-slate-50">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={`Anteprima ${label}`} className="h-full w-full object-cover" />
          ) : (
            <span className="text-[11px] font-bold text-pv-slate-400">{isPdf ? 'PDF' : 'DOC'}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {file ? (
            <>
              <p className="truncate text-[12px] text-pv-slate-700" title={file.name}>
                {file.name}
              </p>
              <p className="text-[11px] text-pv-slate-500">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </>
          ) : (
            <p className="text-[12px] text-pv-slate-500">PDF, JPG o PNG · max 10 MB</p>
          )}
          {erroreUpload && (
            <p className="mt-0.5 text-[11px] font-semibold text-pv-red-500">{erroreUpload}</p>
          )}
          <div className="mt-1.5 flex gap-3">
            <label
              htmlFor={inputId}
              className="cursor-pointer text-[12px] font-semibold text-pv-navy-600 hover:underline"
            >
              {file ? 'Sostituisci' : 'Carica file'}
            </label>
            {file && (
              <button
                type="button"
                onClick={onRemove}
                className="text-[12px] font-semibold text-pv-red-500 hover:underline"
              >
                Rimuovi
              </button>
            )}
          </div>
        </div>
      </div>

      <input
        id={inputId}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/jpg"
        className="sr-only"
        onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}

/**
 * A7: sezione "Documento d'identità" sotto ciascuna parte. Il broker sceglie
 * il tipo documento; per la CI servono fronte+retro, per passaporto/patente un
 * file unico. Il permesso di soggiorno è sempre opzionale. Ogni file viene
 * caricato subito su Blob (client upload) e ne teniamo la BlobRef. Quando la
 * BlobRef del file principale (fronte CI o single) è pronta viene avviato l'OCR
 * di pre-fill via `onMainRef`.
 */
function IdentitaSection({
  titolo,
  docId,
  onDocId,
  files,
  onFiles,
  onMainRef,
}: {
  titolo: string;
  docId: DocIdTipo;
  onDocId: (t: DocIdTipo) => void;
  files: IdentitaFiles;
  onFiles: (updater: (prev: IdentitaFiles) => IdentitaFiles) => void;
  onMainRef: (ref: BlobRef) => void;
}) {
  // Upload di un singolo campo identità su Blob, aggiornando lo slot via
  // `onFiles`. Se è il file principale (main=true), all'esito chiama onMainRef
  // per l'OCR di pre-fill. Se file=null, rimuove lo slot (invalida la ref).
  const handleField = (
    field: keyof IdentitaFiles,
    file: File | null,
    main: boolean,
  ) => {
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
        if (main) onMainRef(ref);
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

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {docId === 'CI' ? (
          <>
            <UploadCard
              label="Fronte"
              slot={files.fronte}
              onSelect={(f) => handleField('fronte', f, true)}
              onRemove={() => handleField('fronte', null, true)}
            />
            <UploadCard
              label="Retro"
              slot={files.retro}
              onSelect={(f) => handleField('retro', f, false)}
              onRemove={() => handleField('retro', null, false)}
            />
          </>
        ) : (
          <UploadCard
            label={docId === 'PASSAPORTO' ? 'Passaporto' : 'Patente'}
            slot={files.single}
            onSelect={(f) => handleField('single', f, true)}
            onRemove={() => handleField('single', null, true)}
          />
        )}
        <UploadCard
          label="Permesso di soggiorno (opzionale)"
          slot={files.permesso}
          onSelect={(f) => handleField('permesso', f, false)}
          onRemove={() => handleField('permesso', null, false)}
        />
      </div>
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

function parteValida(p: Parte): boolean {
  // Schema Documentale v7 (SD-B): tipoSoggetto obbligatorio + se richiesto
  // anche la data corrispondente (visura per AZIENDA/OPERATORE_AUTO,
  // permesso per STRANIERO_EXTRA_UE).
  if (!p.tipoSoggetto) return false;
  if (
    (p.tipoSoggetto === 'AZIENDA' || p.tipoSoggetto === 'OPERATORE_AUTO') &&
    !p.visuraData
  ) {
    return false;
  }
  if (p.tipoSoggetto === 'STRANIERO_EXTRA_UE' && !p.permessoData) return false;

  if (p.isPG) return p.ragioneSociale.trim().length > 0 && p.piva.length === 11;
  return (
    p.nome.trim().length > 0 && p.cognome.trim().length > 0 && p.cf.trim().length === 16
  );
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
