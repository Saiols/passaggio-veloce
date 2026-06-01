'use client';

import { useEffect, useState, useTransition, useRef, useMemo } from 'react';
import { Alert, Button, Checkbox, Field, Input, Select } from '@/components/ui';
import { WizardProgress } from '@/components/wizard-progress';
import { DichiarazionePopup } from '@/components/dichiarazione-popup';
import { RevisioneManualePopup } from '@/components/revisione-manuale-popup';
import { PENALI } from '@/lib/penali/config';
import {
  calcolaDocumentiRichiesti,
  type TipoSoggetto,
} from '@/lib/documenti/engine';
import { extractLibrettoAction, submitNuovaPraticaAction } from './actions';

/**
 * Splitta una stringa "Nome Cognome" in due parti.
 * Per nomi composti (es. "Maria Carla Bianchi") l'ultimo token è cognome.
 * Se la stringa è una sola parola, la usiamo come cognome (caso edge).
 */
function splitNomeCompleto(full: string): { nome: string; cognome: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { nome: '', cognome: parts[0] ?? '' };
  const cognome = parts[parts.length - 1]!;
  const nome = parts.slice(0, -1).join(' ');
  return { nome, cognome };
}

const STEPS = [
  { id: 1, label: 'Tipo & libretto', title: 'Tipo pratica e libretto', hint: 'Scegli il tipo di pratica e carica il libretto di circolazione.' },
  { id: 2, label: 'Parti', title: 'Parti coinvolte', hint: 'Dati del venditore e dell\'acquirente + eventuali flag speciali.' },
  { id: 3, label: 'Invio', title: 'Localizzazione e invio', hint: 'Comune di riferimento e riepilogo finale.' },
] as const;

type Tipo = 'PASSAGGIO_PRIVATO' | 'MINIVOLTURE_MULTIPLE';

type Ocr = {
  targa: string;
  telaio: string;
  proprietarioAttuale: string;
  dataImmatricolazione: string;
  preImm2015: boolean;
  flagComodatoDuso: boolean;
};

function emptyOcr(): Ocr {
  return {
    targa: '',
    telaio: '',
    proprietarioAttuale: '',
    dataImmatricolazione: '',
    preImm2015: false,
    flagComodatoDuso: false,
  };
}

// Tipi documento caricabili per parte (sottoinsieme di DocumentoTipo lato DB).
const DOC_TIPI = [
  'CI_FRONTE',
  'CI_RETRO',
  'CODICE_FISCALE',
  'PROCURA',
  'VISURA_CAMERALE',
  'PERMESSO_SOGGIORNO',
] as const;
type DocTipo = (typeof DOC_TIPI)[number];

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
  documenti: Partial<Record<DocTipo, File>>;
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
  documenti: {},
});

const TIPI_SOGGETTO_VENDITORE: { value: TipoSoggetto; label: string }[] = [
  { value: 'PRIVATO_ITALIANO_CIE', label: 'Privato italiano · CIE elettronica' },
  { value: 'PRIVATO_ITALIANO_CARTACEA', label: 'Privato italiano · CI cartacea' },
  { value: 'STRANIERO_EXTRA_UE', label: 'Straniero extra-UE' },
  { value: 'AZIENDA', label: 'Azienda / Società' },
  { value: 'OPERATORE_AUTO', label: 'Operatore auto / Commerciante (mini voltura)' },
];

const TIPI_SOGGETTO_ACQUIRENTE: { value: TipoSoggetto; label: string }[] =
  TIPI_SOGGETTO_VENDITORE.filter((t) => t.value !== 'OPERATORE_AUTO');

function labelDocTipo(t: DocTipo, isPG: boolean): string {
  if (t === 'CI_FRONTE')
    return isPG ? 'CI legale rappresentante (fronte)' : "Carta d'identità (fronte)";
  if (t === 'CI_RETRO')
    return isPG ? 'CI legale rappresentante (retro)' : "Carta d'identità (retro)";
  if (t === 'CODICE_FISCALE') return 'Tessera codice fiscale';
  if (t === 'PROCURA') return 'Procura';
  if (t === 'VISURA_CAMERALE') return 'Visura camerale';
  if (t === 'PERMESSO_SOGGIORNO') return 'Permesso di soggiorno';
  return t;
}

const DOC_TIPI_FISICA: readonly DocTipo[] = [
  'CI_FRONTE',
  'CI_RETRO',
  'CODICE_FISCALE',
  'PROCURA',
];
const DOC_TIPI_GIURIDICA: readonly DocTipo[] = [
  'VISURA_CAMERALE',
  'CI_FRONTE',
  'CI_RETRO',
];

export function WizardNuovaPratica({ error }: { error?: string }) {
  const [step, setStep] = useState(1);
  const [tipo, setTipo] = useState<Tipo>('PASSAGGIO_PRIVATO');
  const [numeroVeicoli, setNumeroVeicoli] = useState<number>(1);

  const handleTipoChange = (next: Tipo) => {
    setTipo(next);
    setNumeroVeicoli(next === 'PASSAGGIO_PRIVATO' ? 1 : 2);
  };
  const librettoRef = useRef<File | null>(null);
  const [librettoName, setLibrettoName] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrManuale, setOcrManuale] = useState(false);
  const [ocr, setOcr] = useState<Ocr | null>(null);

  const [venditore, setVenditore] = useState<Parte>(emptyParte());
  const [acquirente, setAcquirente] = useState<Parte>(emptyParte());
  const [flagCointestazione, setFlagCointestazione] = useState(false);
  const [flagMinivoltura, setFlagMinivoltura] = useState(false);
  const [flagProcura, setFlagProcura] = useState(false);
  // Schema Documentale v7 (SD-B): casi speciali aggiuntivi
  const [flagSuccessione, setFlagSuccessione] = useState(false);
  const [flagMinore, setFlagMinore] = useState(false);

  const [comune, setComune] = useState('');
  const [provincia, setProvincia] = useState('');

  // Q-10: pre-fill nome venditore da proprietarioAttuale del libretto. Solo
  // se l'utente non ha ancora toccato i campi nome+cognome venditore (PF).
  useEffect(() => {
    if (!ocr?.proprietarioAttuale) return;
    setVenditore((prev) => {
      if (prev.isPG || prev.nome.trim() || prev.cognome.trim()) return prev;
      const { nome, cognome } = splitNomeCompleto(ocr.proprietarioAttuale);
      if (!nome && !cognome) return prev;
      return { ...prev, nome, cognome };
    });
    // ocr è preso come deps ma il setter funzionale legge sempre lo state
    // più fresco; il check prev.nome/cognome evita override se già modificato.
  }, [ocr?.proprietarioAttuale]);

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
  // tramite engine. Si aggiorna in real-time mentre il broker compila i campi
  // di tipo soggetto / visura / permesso / flag speciali. Mostrato nel
  // riepilogo finale per dare feedback chiaro su cosa serve caricare.
  const esitoSchema = useMemo(() => {
    return calcolaDocumentiRichiesti({
      preImm2015: ocr?.preImm2015 ?? false,
      flagComodatoDuso: ocr?.flagComodatoDuso ?? false,
      venditoreTipoSoggetto: venditore.tipoSoggetto,
      venditoreVisuraData: venditore.visuraData
        ? new Date(venditore.visuraData)
        : null,
      venditorePermessoData: venditore.permessoData
        ? new Date(venditore.permessoData)
        : null,
      flagProcura,
      flagSuccessione,
      acquirenteTipoSoggetto: acquirente.tipoSoggetto,
      acquirenteVisuraData: acquirente.visuraData
        ? new Date(acquirente.visuraData)
        : null,
      acquirentePermessoData: acquirente.permessoData
        ? new Date(acquirente.permessoData)
        : null,
      flagMinore,
    });
  }, [
    ocr?.preImm2015,
    ocr?.flagComodatoDuso,
    venditore.tipoSoggetto,
    venditore.visuraData,
    venditore.permessoData,
    flagProcura,
    flagSuccessione,
    acquirente.tipoSoggetto,
    acquirente.visuraData,
    acquirente.permessoData,
    flagMinore,
  ]);

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    librettoRef.current = file;
    setLibrettoName(file.name);
    setOcrError(null);
    setOcrManuale(false);
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append('libretto', file);
      const res = await extractLibrettoAction(fd);
      if (res.ok) {
        setOcr({
          targa: res.data.targa ?? '',
          telaio: res.data.telaio ?? '',
          proprietarioAttuale: res.data.proprietarioAttuale ?? '',
          dataImmatricolazione: res.data.dataImmatricolazione ?? '',
          preImm2015: res.data.preImm2015,
          flagComodatoDuso: res.data.flagComodatoDuso,
        });
      } else {
        setOcrError(res.error);
      }
    } catch (err) {
      setOcrError((err as Error).message);
    } finally {
      setExtracting(false);
    }
  };

  const handleFinalSubmit = () => {
    if (!librettoRef.current || !ocr) return;
    const fd = new FormData();
    fd.append('libretto', librettoRef.current);
    fd.append('tipo', tipo);
    fd.append('numeroVeicoli', String(numeroVeicoli));
    fd.append('targa', ocr.targa);
    fd.append('telaio', ocr.telaio);
    fd.append('proprietarioAttuale', ocr.proprietarioAttuale);
    fd.append('dataImmatricolazione', ocr.dataImmatricolazione);
    fd.append('preImm2015', ocr.preImm2015 ? 'true' : 'false');
    fd.append('flagComodatoDuso', ocr.flagComodatoDuso ? 'true' : 'false');
    fd.append('ocrManuale', ocrManuale ? 'true' : 'false');

    fd.append('venditoreIsPG', venditore.isPG ? 'true' : 'false');
    if (venditore.isPG) {
      fd.append('venditoreRagioneSociale', venditore.ragioneSociale);
      fd.append('venditorePIVA', venditore.piva);
    } else {
      fd.append('venditoreNome', venditore.nome);
      fd.append('venditoreCognome', venditore.cognome);
      fd.append('venditoreCF', venditore.cf);
    }
    fd.append('venditoreTelefono', venditore.telefono);
    fd.append('venditoreEmail', venditore.email);

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

    // Documenti caricati per ciascuna parte (tutti opzionali)
    for (const t of DOC_TIPI) {
      const f = venditore.documenti[t];
      if (f) fd.append(`venditore_${t}`, f);
    }
    for (const t of DOC_TIPI) {
      const f = acquirente.documenti[t];
      if (f) fd.append(`acquirente_${t}`, f);
    }

    fd.append('flagCointestazione', flagCointestazione ? 'true' : 'false');
    fd.append('flagMinivoltura', flagMinivoltura ? 'true' : 'false');
    fd.append('flagProcura', flagProcura ? 'true' : 'false');
    fd.append('flagSuccessione', flagSuccessione ? 'true' : 'false');
    fd.append('flagMinore', flagMinore ? 'true' : 'false');

    // Schema Documentale v7 (SD-B): tipo soggetto + date validità.
    if (venditore.tipoSoggetto) {
      fd.append('venditoreTipoSoggetto', venditore.tipoSoggetto);
    }
    if (venditore.visuraData) fd.append('venditoreVisuraData', venditore.visuraData);
    if (venditore.permessoData) fd.append('venditorePermessoData', venditore.permessoData);

    if (acquirente.tipoSoggetto) {
      fd.append('acquirenteTipoSoggetto', acquirente.tipoSoggetto);
    }
    if (acquirente.visuraData) fd.append('acquirenteVisuraData', acquirente.visuraData);
    if (acquirente.permessoData) fd.append('acquirentePermessoData', acquirente.permessoData);

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
  const canStep2 =
    !!ocr &&
    ocr.targa.length >= 5 &&
    ocr.telaio.length >= 11 &&
    ocr.proprietarioAttuale.length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(ocr.dataImmatricolazione);

  const canStep3 = parteValida(venditore) && parteValida(acquirente);

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
              <Field label="Tipo pratica" required>
                <Select
                  value={tipo}
                  onChange={(e) => handleTipoChange(e.target.value as Tipo)}
                >
                  <option value="PASSAGGIO_PRIVATO">Passaggio di proprietà privato</option>
                  <option value="MINIVOLTURE_MULTIPLE">
                    Minivolture multiple (commercianti)
                  </option>
                </Select>
              </Field>

              <div className="mt-4 rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 p-3 text-[12.5px] leading-relaxed text-pv-slate-700">
                <p className="mb-1.5 font-bold uppercase tracking-wider text-[11px] text-pv-slate-500">
                  Quando usare quale tipo
                </p>
                <ul className="space-y-1.5">
                  <li>
                    <span className="font-semibold text-pv-navy-800">
                      Passaggio di proprietà privato
                    </span>
                    : un solo veicolo, da privato a privato. È il caso classico
                    del cliente che vende l&apos;auto a un altro privato.
                  </li>
                  <li>
                    <span className="font-semibold text-pv-navy-800">
                      Minivolture multiple
                    </span>
                    : commercianti / concessionari che caricano più veicoli in
                    un&apos;unica pratica. Richiede almeno 2 veicoli.
                  </li>
                </ul>
              </div>

              {tipo === 'MINIVOLTURE_MULTIPLE' && (
                <div className="mt-4">
                  <Field label="Numero veicoli" required>
                    <Input
                      type="number"
                      min={2}
                      max={50}
                      value={numeroVeicoli}
                      onChange={(e) =>
                        setNumeroVeicoli(Math.max(2, Number(e.target.value) || 2))
                      }
                    />
                  </Field>
                  <p className="mt-1 text-[12px] text-pv-slate-500">
                    Le minivolture multiple richiedono almeno 2 veicoli.
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <Field label="Libretto di circolazione (PDF/JPG/PNG)" required>
                <div className="flex flex-col gap-2 rounded-[10px] border-[1.5px] border-dashed border-pv-slate-300 bg-pv-slate-50 px-4 py-3 text-[13px] sm:flex-row sm:items-center sm:justify-between">
                  <span className="truncate text-pv-slate-700">
                    {librettoName ?? 'Seleziona file o scatta una foto del libretto'}
                  </span>
                  <div className="flex shrink-0 gap-2">
                    {/* Desktop / file picker classico (PDF/JPG/PNG) */}
                    <label className="cursor-pointer rounded-[8px] bg-pv-navy-700 px-3 py-1.5 font-semibold text-white hover:bg-pv-navy-800">
                      {librettoName ? 'Cambia' : 'Sfoglia'}
                      <input
                        type="file"
                        accept="application/pdf,image/jpeg,image/png"
                        onChange={onFileSelected}
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
                        onChange={onFileSelected}
                        className="sr-only"
                      />
                    </label>
                  </div>
                </div>
              </Field>

              {extracting && (
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
              {ocrError && (
                <div className="mt-3 space-y-3">
                  <Alert variant="error">{ocrError}</Alert>
                  {!ocr && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setOcr(emptyOcr());
                        setOcrManuale(true);
                        setOcrError(null);
                      }}
                    >
                      Inserisci i dati manualmente
                    </Button>
                  )}
                </div>
              )}

              {ocr && (
                <div className="mt-4 rounded-[12px] border border-pv-slate-200 bg-pv-slate-50 p-4">
                  <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                    Dati estratti — correggi se serve
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Targa" required>
                      <Input
                        value={ocr.targa}
                        onChange={(e) => setOcr({ ...ocr, targa: e.target.value.toUpperCase() })}
                      />
                    </Field>
                    <Field label="Telaio" required>
                      <Input
                        value={ocr.telaio}
                        onChange={(e) => setOcr({ ...ocr, telaio: e.target.value.toUpperCase() })}
                      />
                    </Field>
                    <Field label="Proprietario attuale" required className="sm:col-span-2">
                      <Input
                        value={ocr.proprietarioAttuale}
                        onChange={(e) =>
                          setOcr({ ...ocr, proprietarioAttuale: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Data immatricolazione" required>
                      <Input
                        type="date"
                        value={ocr.dataImmatricolazione}
                        onChange={(e) =>
                          setOcr({ ...ocr, dataImmatricolazione: e.target.value })
                        }
                      />
                    </Field>
                    <div className="flex flex-col gap-2 pt-6">
                      <label className="flex items-center gap-2 text-[13px] text-pv-slate-700">
                        <Checkbox
                          checked={ocr.preImm2015}
                          onChange={(e) => setOcr({ ...ocr, preImm2015: e.target.checked })}
                        />
                        Pre-2015 (richiede certificato di proprietà)
                      </label>
                      <label className="flex items-center gap-2 text-[13px] text-pv-slate-700">
                        <Checkbox
                          checked={ocr.flagComodatoDuso}
                          onChange={(e) =>
                            setOcr({ ...ocr, flagComodatoDuso: e.target.checked })
                          }
                        />
                        Comodato d&apos;uso rilevato
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button disabled={!canStep2} onClick={() => setStep(2)}>
                Avanti
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">Venditore</h2>
              <ParteForm
                parte={venditore}
                onChange={setVenditore}
                tipiSoggetto={TIPI_SOGGETTO_VENDITORE}
              />
            </div>

            <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
              <h2 className="mb-3 text-[15px] font-bold text-pv-navy-800">Acquirente</h2>
              <ParteForm
                parte={acquirente}
                onChange={setAcquirente}
                tipiSoggetto={TIPI_SOGGETTO_ACQUIRENTE}
              />
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
              <Button disabled={!canStep3} onClick={() => setStep(3)}>
                Avanti
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
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
                <RiepilogoRow label="Tipo" value={labelTipo(tipo)} />
                <RiepilogoRow label="Libretto" value={librettoName ?? '—'} />
                <RiepilogoRow label="Targa" value={ocr?.targa ?? '—'} />
                <RiepilogoRow label="Telaio" value={ocr?.telaio ?? '—'} />
                <RiepilogoRow label="Proprietario" value={ocr?.proprietarioAttuale ?? '—'} />
                <RiepilogoRow
                  label="Venditore"
                  value={parteNome(venditore)}
                />
                <RiepilogoRow
                  label="Acquirente"
                  value={parteNome(acquirente)}
                />
                {tipo === 'MINIVOLTURE_MULTIPLE' && (
                  <RiepilogoRow label="Numero veicoli" value={String(numeroVeicoli)} />
                )}
                <RiepilogoRow label="Comune" value={comune || '—'} />
              </dl>
            </div>

            {/* Schema Documentale v7 (SD-B): preview documenti richiesti via
                engine puro. Mostra blocchi/incompletezze in tempo reale e
                lista doc obbligatori per il broker. */}
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
              <Button variant="secondary" onClick={() => setStep(2)} disabled={submitting}>
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

      <DocumentiUploader parte={parte} onChange={onChange} />
    </div>
  );
}

function DocumentiUploader({
  parte,
  onChange,
}: {
  parte: Parte;
  onChange: (p: Parte) => void;
}) {
  const tipi = parte.isPG ? DOC_TIPI_GIURIDICA : DOC_TIPI_FISICA;

  const handleFile = (tipo: DocTipo, file: File | null) => {
    const next = { ...parte.documenti };
    if (file) next[tipo] = file;
    else delete next[tipo];
    onChange({ ...parte, documenti: next });
  };

  return (
    <div className="mt-5 rounded-[12px] border border-pv-slate-200 bg-pv-slate-50 p-4">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
        Documenti (opzionali)
      </p>
      <p className="mb-3 text-[12px] text-pv-slate-500">
        PDF / JPG / PNG · max 10 MB per file. Vengono salvati e restano scaricabili
        in ogni momento dal dettaglio pratica.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {tipi.map((t) => (
          <DocFileInput
            key={t}
            label={labelDocTipo(t, parte.isPG)}
            file={parte.documenti[t] ?? null}
            onChange={(f) => handleFile(t, f)}
          />
        ))}
      </div>
    </div>
  );
}

function DocFileInput({
  label,
  file,
  onChange,
}: {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-pv-slate-700">
        {label}
      </label>
      <label className="mt-1 flex cursor-pointer items-center justify-between gap-2 rounded-[8px] border-[1.5px] border-dashed border-pv-slate-300 bg-white px-3 py-2 text-[12px] hover:border-pv-navy-600">
        <span className="truncate text-pv-slate-700">
          {file ? file.name : 'Seleziona file'}
        </span>
        <span className="shrink-0 text-[11px] font-semibold text-pv-navy-600">
          {file ? 'Cambia' : 'Sfoglia'}
        </span>
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(e) => onChange(e.target.files?.[0] ?? null)}
          className="sr-only"
        />
      </label>
      {file && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="mt-1 text-[11px] text-pv-slate-500 hover:text-pv-red-500 hover:underline"
        >
          Rimuovi
        </button>
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

function labelTipo(t: Tipo): string {
  if (t === 'PASSAGGIO_PRIVATO') return 'Passaggio di proprietà privato';
  if (t === 'MINIVOLTURE_MULTIPLE') return 'Minivolture multiple';
  return t;
}

/**
 * Schema Documentale v7 (SD-B): preview live dei documenti richiesti
 * dall'engine puro, mostrato come ultima card del wizard prima del submit.
 * - kind=INPUT_INCOMPLETO → spiega cosa manca compilare (tipo soggetto)
 * - kind=BLOCCO → mostra motivo + soluzione (ostativo)
 * - kind=OK → lista checklist documenti obbligatori, raggruppati per parte
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
          soggetto del venditore e dell&apos;acquirente nello step Parti.
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

  // Raggruppa per parte
  const grouped = new Map<string, typeof esito.documentiRichiesti>();
  for (const d of esito.documentiRichiesti) {
    const list = grouped.get(d.parte) ?? [];
    list.push(d);
    grouped.set(d.parte, list);
  }

  const labelParte: Record<string, string> = {
    VEICOLO: 'Veicolo',
    VENDITORE: 'Venditore',
    ACQUIRENTE: 'Acquirente',
    PROCURATORE: 'Procuratore',
    EREDE: 'Erede / successione',
    TUTORE: 'Tutore (compratore minorenne)',
    AMMINISTRATORE_VENDITORE: 'Amministratore (venditore)',
    AMMINISTRATORE_ACQUIRENTE: 'Amministratore (acquirente)',
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
              {labelParte[parte] ?? parte}
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
