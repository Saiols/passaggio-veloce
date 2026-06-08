'use client';

import { useState, useMemo, useTransition, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import {
  registerStep1AccountSchema,
  registerStep2CompanySchema,
  registerStep4PaymentSchema,
} from '@/lib/auth/schemas';
import { Alert, Button, Checkbox, Field, Input, PasswordInput, Select } from '@/components/ui';
import { AddressAutocomplete, type AddressParts } from '@/components/address-autocomplete';
import { WizardProgress } from '@/components/wizard-progress';
import { DocCard } from '@/components/doc-card';
import { validateRegistrationDocuments } from '@/lib/auth/document-validation';
import { registerAction, checkPromoCodeAction, verifyRegistrationDocumentsAction } from '../actions';
import type { PromoCheckResult } from '@/lib/promo/evaluate';
import { formatCurrencyCent } from '@/lib/format';
import { uploadToBlob, type BlobRef } from '@/lib/blob/upload-client';

type AccountData = z.infer<typeof registerStep1AccountSchema>;
type CompanyData = z.infer<typeof registerStep2CompanySchema>;
type PaymentData = z.infer<typeof registerStep4PaymentSchema>;

// I documenti non viaggiano piu' come File dentro le Server Action (limite 4,5 MB
// sul body serverless): vengono caricati dal browser direttamente su Vercel Blob
// e qui teniamo solo le BlobRef (chiave + metadati), che poi inviamo come JSON.
type DocumentsData = {
  ciFronte: BlobRef;
  ciRetro: BlobRef;
  codiceFiscale: BlobRef;
  visuraCamerale: BlobRef;
};

/**
 * Esito di blocco KYC per singolo documento (mirror del tipo server-side
 * `KycFailure` in @/lib/kyc/verify, che però è `server-only`: qui ne teniamo
 * la forma minimale usata in UI per evitare l'import del modulo server).
 */
type KycFailureUi = { doc?: 'CI' | 'CF' | 'VISURA'; message: string };

type WizardData = {
  account?: AccountData;
  company?: CompanyData;
  documents?: DocumentsData;
  payment?: PaymentData;
};

const STEPS = [
  { id: 1, label: 'Account', title: 'Crea il tuo account', hint: 'Inserisci i dati del titolare o del responsabile dell\'account. Questi dati identificano la persona fisica che gestisce il profilo sulla piattaforma.' },
  { id: 2, label: 'Azienda', title: 'Dati azienda', hint: 'Ragione sociale, partita IVA, sede legale e contatti.' },
  { id: 3, label: 'Documenti', title: 'Documenti richiesti', hint: 'CI, codice fiscale e visura camerale per la verifica KYC.' },
  { id: 4, label: 'Pagamento', title: 'Pagamento e condizioni', hint: 'IBAN per il mandato SEPA e accettazione dei Termini.' },
] as const;

export function RegisterWizard({
  forcedCompanyType,
}: {
  /**
   * Quando il flusso di registrazione viene aperto da uno dei due entry point
   * dedicati (/register/dealer o /register/agenzia, item 5 release 2026-05),
   * il tipo azienda e' gia' deciso e il select viene nascosto / pre-impostato.
   */
  forcedCompanyType?: 'DEALER' | 'AGENZIA';
} = {}) {
  const searchParams = useSearchParams();
  const referralCode = searchParams.get('ref') ?? undefined;
  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>(
    forcedCompanyType
      ? { company: { type: forcedCompanyType } as CompanyData }
      : {},
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [kycErrors, setKycErrors] = useState<KycFailureUi[]>([]);
  // Cache verifica documenti: evita di ri-chiamare l'OCR su Back→Avanti senza
  // modifiche. `kycToken` viene passato al submit per non ri-fare l'OCR lì.
  const [kycToken, setKycToken] = useState<string | null>(null);
  const [docsVerified, setDocsVerified] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [promoOutcome, setPromoOutcome] = useState<
    { applied: true; amountCent: number } | { applied: false } | null
  >(null);
  const [isPending, startTransition] = useTransition();
  const [isVerifyingDocs, startVerifyDocs] = useTransition();

  const handleAccount = (values: AccountData) => {
    setData((d) => ({ ...d, account: values }));
    setStep(2);
  };

  const handleCompany = (values: CompanyData) => {
    setData((d) => ({ ...d, company: values }));
    // I dati azienda incidono sul cross-check visura: invalida la verifica.
    setDocsVerified(false);
    setKycToken(null);
    setKycErrors([]);
    setStep(3);
  };

  // I documenti sono cambiati: la verifica precedente non vale più.
  const invalidateDocsVerification = () => {
    setKycErrors([]);
    setDocsVerified(false);
    setKycToken(null);
  };

  // Gate KYC anticipato: la verifica OCR gira QUI (Documenti → Pagamento), così
  // l'utente è bloccato/sbloccato subito invece che dopo aver compilato il pagamento.
  const handleDocuments = (values: DocumentsData) => {
    if (!data.company) {
      setSubmitError('Completa prima i dati azienda');
      setStep(2);
      return;
    }
    // Già verificati questi documenti (azienda invariata): salta la richiesta.
    if (docsVerified && kycToken) {
      setData((d) => ({ ...d, documents: values }));
      setStep(4);
      return;
    }
    setKycErrors([]);
    setSubmitError(null);
    startVerifyDocs(async () => {
      const fd = new FormData();
      fd.set('company', JSON.stringify(data.company));
      // I file sono gia' su Blob: inviamo solo le BlobRef come mappa slot→ref.
      fd.set(
        'blobRefs',
        JSON.stringify({
          CI_FRONTE: values.ciFronte,
          CI_RETRO: values.ciRetro,
          CODICE_FISCALE: values.codiceFiscale,
          VISURA_CAMERALE: values.visuraCamerale,
        }),
      );

      const res = await verifyRegistrationDocumentsAction(fd);
      if (res.ok) {
        setData((d) => ({ ...d, documents: values }));
        setKycToken(res.token ?? null);
        setDocsVerified(true);
        setStep(4);
      } else if (res.kycFailures && res.kycFailures.length > 0) {
        setKycErrors(res.kycFailures);
        setDocsVerified(false);
        setKycToken(null);
      } else {
        setSubmitError(res.error);
      }
    });
  };

  const handlePayment = (values: PaymentData, promoCode: string) => {
    setData((d) => ({ ...d, payment: values }));
    if (!data.account || !data.company || !data.documents) {
      setSubmitError('Dati mancanti, ricomincia il wizard');
      setStep(1);
      return;
    }

    setSubmitError(null);
    setKycErrors([]);
    const docs = data.documents;
    startTransition(async () => {
      const fd = new FormData();
      fd.set(
        'payload',
        JSON.stringify({
          account: data.account,
          company: data.company,
          payment: values,
          referralCode,
          promoCode,
          kycToken,
        }),
      );
      // I file sono gia' su Blob: inviamo solo le BlobRef come mappa slot→ref.
      fd.set(
        'blobRefs',
        JSON.stringify({
          CI_FRONTE: docs.ciFronte,
          CI_RETRO: docs.ciRetro,
          CODICE_FISCALE: docs.codiceFiscale,
          VISURA_CAMERALE: docs.visuraCamerale,
        }),
      );

      const result = await registerAction(fd);

      if (result.ok) {
        setToken(result.emailVerificationToken);
        setPromoOutcome(result.promo ?? null);
      } else if (result.kycFailures && result.kycFailures.length > 0) {
        // Gate KYC non superato: torna allo step Documenti e mostra i motivi
        // di blocco per documento, così l'utente sa esattamente cosa correggere.
        setKycErrors(result.kycFailures);
        setStep(3);
      } else {
        setSubmitError(result.error);
      }
    });
  };

  const currentStep = STEPS.find((s) => s.id === step)!;

  return (
    <>
      <WizardProgress steps={STEPS} current={step} />

      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            {currentStep.title}
          </h1>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-pv-slate-500">
            {currentStep.hint}
          </p>
        </header>

        <div className="space-y-5">
          {token && (
            <div className="rounded-lg bg-pv-amber-50 border border-pv-amber-500 p-4 mt-4 text-sm">
              <p className="font-bold text-pv-navy-900">🧪 Modalità DEMO</p>
              <p className="text-pv-navy-700 mt-1">
                Il tuo account è già attivo. In produzione avresti ricevuto un&apos;email
                con questo link di verifica:
              </p>
              <a
                href={`/verify-email?token=${token}`}
                className="text-pv-navy-700 underline mt-2 inline-block break-all"
              >
                {`/verify-email?token=${token}`}
              </a>
              <p className="text-pv-navy-700 mt-2">
                Puoi{' '}
                <a href="/login" className="underline font-semibold">
                  accedere subito
                </a>
                .
              </p>
            </div>
          )}
          {promoOutcome?.applied === true && (
            <div className="mt-4 rounded-lg border border-pv-green-500 bg-pv-green-50 p-4 text-sm text-pv-navy-900">
              🎁 Promozione applicata: <strong>{formatCurrencyCent(promoOutcome.amountCent)}</strong> accreditati sul tuo wallet.
            </div>
          )}
          {promoOutcome && !promoOutcome.applied && (
            <div className="mt-4 rounded-lg border border-pv-amber-500 bg-pv-amber-50 p-4 text-sm text-pv-navy-900">
              Codice promozionale non valido: nessuna promozione attivata.
            </div>
          )}
          {submitError && <Alert variant="error">{submitError}</Alert>}

          {step === 1 && <AccountStep defaultValues={data.account} onNext={handleAccount} />}
          {step === 2 && (
            <CompanyStep
              defaultValues={data.company}
              forcedCompanyType={forcedCompanyType}
              onBack={() => setStep(1)}
              onNext={handleCompany}
            />
          )}
          {step === 3 && (
            <DocumentsStep
              defaultValues={data.documents}
              kycErrors={kycErrors}
              onDocsChanged={invalidateDocsVerification}
              onBack={() => setStep(2)}
              onNext={handleDocuments}
              isVerifying={isVerifyingDocs}
            />
          )}
          {step === 4 && (
            <PaymentStep
              defaultValues={data.payment}
              onBack={() => setStep(3)}
              onSubmit={handlePayment}
              isSubmitting={isPending}
            />
          )}
        </div>
      </div>
    </>
  );
}

// ============================================================
// STEP 1 - ACCOUNT
// ============================================================

/** Normalizza un valore data (Date | string) nel formato yyyy-mm-dd per <input type="date">. */
function toDateInputValue(value: unknown): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function AccountStep({
  defaultValues,
  onNext,
}: {
  defaultValues?: AccountData;
  onNext: (data: AccountData) => void;
}) {
  // `dataNascita` è coerced a Date dallo schema; l'input type="date" vuole una
  // stringa yyyy-mm-dd, altrimenti al "Indietro" il campo resta vuoto.
  const formDefaults = defaultValues
    ? ({ ...defaultValues, dataNascita: toDateInputValue(defaultValues.dataNascita) } as unknown as AccountData)
    : undefined;

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<AccountData>({
    resolver: zodResolver(registerStep1AccountSchema),
    defaultValues: formDefaults,
    mode: 'onChange',
  });

  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-4">
      <Field label="Email" required error={errors.email?.message}>
        <Input type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Password" required error={errors.password?.message}>
          <PasswordInput
            autoComplete="new-password"
            invalid={!!errors.password}
            {...register('password')}
          />
        </Field>
        <Field label="Conferma password" required error={errors.passwordConfirm?.message}>
          <PasswordInput
            autoComplete="new-password"
            invalid={!!errors.passwordConfirm}
            {...register('passwordConfirm')}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nome referente account — titolare, amministratore o delegato" required error={errors.nome?.message}>
          <Input invalid={!!errors.nome} {...register('nome')} />
        </Field>
        <Field label="Cognome referente account — titolare, amministratore o delegato" required error={errors.cognome?.message}>
          <Input invalid={!!errors.cognome} {...register('cognome')} />
        </Field>
      </div>

      <Field label="Codice Fiscale" required error={errors.codiceFiscale?.message}>
        <Input invalid={!!errors.codiceFiscale} {...register('codiceFiscale')} />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Data di nascita" required error={errors.dataNascita?.message}>
          <Input type="date" invalid={!!errors.dataNascita} {...register('dataNascita')} />
        </Field>
        <Field label="Luogo di nascita" required error={errors.luogoNascita?.message}>
          <Input invalid={!!errors.luogoNascita} {...register('luogoNascita')} />
        </Field>
      </div>

      <Button type="submit" disabled={!isValid} fullWidth>
        Avanti
      </Button>
    </form>
  );
}

// ============================================================
// STEP 2 - AZIENDA
// ============================================================

function CompanyStep({
  defaultValues,
  forcedCompanyType,
  onBack,
  onNext,
}: {
  defaultValues?: CompanyData;
  forcedCompanyType?: 'DEALER' | 'AGENZIA';
  onBack: () => void;
  onNext: (data: CompanyData) => void;
}) {
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isValid },
  } = useForm<CompanyData>({
    resolver: zodResolver(registerStep2CompanySchema),
    defaultValues: forcedCompanyType
      ? { ...defaultValues, type: forcedCompanyType }
      : defaultValues,
    mode: 'onChange',
  });

  const applyAddress = (p: AddressParts) => {
    const opts = { shouldValidate: true, shouldDirty: true } as const;
    setValue('indirizzo', p.indirizzo, opts);
    setValue('civico', p.civico, opts);
    setValue('citta', p.citta, opts);
    setValue('cap', p.cap, opts);
    setValue('provincia', p.provincia, opts);
  };

  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-4">
      {forcedCompanyType ? (
        <input type="hidden" {...register('type')} value={forcedCompanyType} />
      ) : (
        <Field label="Tipo azienda" required error={errors.type?.message}>
          <Select invalid={!!errors.type} {...register('type')} defaultValue="">
            <option value="" disabled>
              Seleziona...
            </option>
            <option value="DEALER">Dealer / Commerciante</option>
            <option value="AGENZIA">Agenzia pratiche auto</option>
          </Select>
        </Field>
      )}

      <Field label="Ragione sociale" required error={errors.ragioneSociale?.message}>
        <Input invalid={!!errors.ragioneSociale} {...register('ragioneSociale')} />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="P.IVA" required error={errors.partitaIva?.message}>
          <Input invalid={!!errors.partitaIva} {...register('partitaIva')} />
        </Field>
        <Field label="Codice SDI" required error={errors.codiceSdi?.message}>
          <Input invalid={!!errors.codiceSdi} {...register('codiceSdi')} />
        </Field>
      </div>

      <Field label="PEC" required error={errors.pec?.message}>
        <Input type="email" invalid={!!errors.pec} {...register('pec')} />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Email aziendale" required error={errors.email?.message}>
          <Input type="email" invalid={!!errors.email} {...register('email')} />
        </Field>
        <Field label="Telefono" required error={errors.telefono?.message}>
          <Input invalid={!!errors.telefono} {...register('telefono')} />
        </Field>
      </div>

      <AddressAutocomplete onSelect={applyAddress} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_140px]">
        <Field label="Indirizzo (via/piazza)" required error={errors.indirizzo?.message}>
          <Input invalid={!!errors.indirizzo} {...register('indirizzo')} />
        </Field>
        <Field label="Civico" required error={errors.civico?.message}>
          <Input invalid={!!errors.civico} {...register('civico')} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field label="Città" required error={errors.citta?.message}>
          <Input invalid={!!errors.citta} {...register('citta')} />
        </Field>
        <Field label="CAP" required error={errors.cap?.message}>
          <Input invalid={!!errors.cap} {...register('cap')} />
        </Field>
        <Field label="Prov." required error={errors.provincia?.message}>
          <Input maxLength={2} invalid={!!errors.provincia} {...register('provincia')} />
        </Field>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <Button type="button" variant="secondary" onClick={onBack} className="sm:w-auto">
          Indietro
        </Button>
        <Button type="submit" disabled={!isValid} className="sm:flex-1">
          Avanti
        </Button>
      </div>
    </form>
  );
}

// ============================================================
// STEP 3 - DOCUMENTI KYC
// ============================================================

/**
 * Stato di un singolo slot documento nello step KYC. Teniamo il File solo per
 * l'anteprima/visualizzazione nella DocCard; ciò che conta per il submit è la
 * `ref` (BlobRef), prodotta dall'upload diretto su Blob alla selezione del file.
 */
type DocSlotState = {
  file: File | null;
  ref: BlobRef | null;
  /** 'idle' nessun file · 'uploading' caricamento in corso · 'done' caricato · 'error' fallito. */
  status: 'idle' | 'uploading' | 'done' | 'error';
  progress: number;
  errorMsg?: string;
};

const EMPTY_SLOT: DocSlotState = { file: null, ref: null, status: 'idle', progress: 0 };

type SlotKey = 'ciFronte' | 'ciRetro' | 'codiceFiscale' | 'visuraCamerale';

const SLOT_TIPO: Record<SlotKey, 'CI_FRONTE' | 'CI_RETRO' | 'CODICE_FISCALE' | 'VISURA_CAMERALE'> = {
  ciFronte: 'CI_FRONTE',
  ciRetro: 'CI_RETRO',
  codiceFiscale: 'CODICE_FISCALE',
  visuraCamerale: 'VISURA_CAMERALE',
};

function DocumentsStep({
  defaultValues,
  kycErrors,
  onDocsChanged,
  onBack,
  onNext,
  isVerifying,
}: {
  defaultValues?: DocumentsData;
  kycErrors: KycFailureUi[];
  onDocsChanged: () => void;
  onBack: () => void;
  onNext: (data: DocumentsData) => void;
  isVerifying: boolean;
}) {
  // defaultValues ora contiene BlobRef (file già caricati in un passaggio
  // precedente del wizard): ripristiniamo lo stato "done" senza il File (non
  // più disponibile dopo un Back/Avanti, ma non serve: abbiamo già la ref).
  const fromRef = (ref?: BlobRef): DocSlotState =>
    ref ? { file: null, ref, status: 'done', progress: 100 } : EMPTY_SLOT;

  const [ciFronte, setCiFronte] = useState<DocSlotState>(fromRef(defaultValues?.ciFronte));
  const [ciRetro, setCiRetro] = useState<DocSlotState>(fromRef(defaultValues?.ciRetro));
  const [codiceFiscale, setCodiceFiscale] = useState<DocSlotState>(
    fromRef(defaultValues?.codiceFiscale),
  );
  const [visuraCamerale, setVisuraCamerale] = useState<DocSlotState>(
    fromRef(defaultValues?.visuraCamerale),
  );
  const [error, setError] = useState<string | null>(null);

  const slots: Record<SlotKey, DocSlotState> = {
    ciFronte,
    ciRetro,
    codiceFiscale,
    visuraCamerale,
  };
  const setters: Record<SlotKey, (s: DocSlotState) => void> = {
    ciFronte: setCiFronte,
    ciRetro: setCiRetro,
    codiceFiscale: setCodiceFiscale,
    visuraCamerale: setVisuraCamerale,
  };

  // Validazione rule-based sulle ref caricate (mime/size dei file su Blob).
  const validation = useMemo(() => {
    const keys: SlotKey[] = ['ciFronte', 'ciRetro', 'codiceFiscale', 'visuraCamerale'];
    if (keys.some((k) => slots[k].status === 'uploading')) {
      return { ok: false as const, error: 'Attendi il caricamento dei documenti' };
    }
    if (!keys.every((k) => slots[k].ref)) {
      return { ok: false as const, error: 'Carica tutti i documenti richiesti' };
    }
    return validateRegistrationDocuments(
      keys.map((k) => ({
        tipo: SLOT_TIPO[k],
        mimeType: slots[k].ref!.type,
        sizeBytes: slots[k].ref!.size,
        originalFilename: slots[k].ref!.name,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ciFronte, ciRetro, codiceFiscale, visuraCamerale]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setError(null);
    onNext({
      ciFronte: ciFronte.ref!,
      ciRetro: ciRetro.ref!,
      codiceFiscale: codiceFiscale.ref!,
      visuraCamerale: visuraCamerale.ref!,
    });
  };

  // Selezione/sostituzione di un documento: invalida la verifica precedente e
  // avvia subito l'upload diretto su Blob, aggiornando progress e stato. La ref
  // ottenuta è ciò che verrà inviato alle Server Action (niente File nel body).
  const onDocChange = (key: SlotKey) => async (f: File | null) => {
    onDocsChanged();
    setError(null);
    const setSlot = setters[key];
    if (!f) {
      setSlot(EMPTY_SLOT);
      return;
    }
    setSlot({ file: f, ref: null, status: 'uploading', progress: 0 });
    try {
      const ref = await uploadToBlob(f, 'registrazione', (pct) =>
        setSlot({ file: f, ref: null, status: 'uploading', progress: pct }),
      );
      setSlot({ file: f, ref, status: 'done', progress: 100 });
    } catch (err) {
      setSlot({
        file: f,
        ref: null,
        status: 'error',
        progress: 0,
        errorMsg: err instanceof Error ? err.message : 'Caricamento non riuscito',
      });
    }
  };

  // Documenti coinvolti nel blocco KYC, per evidenziare le rispettive card
  // (CI → carta d'identità fronte/retro, CF → tessera, VISURA → visura).
  const failedDocs = new Set(kycErrors.map((f) => f.doc).filter(Boolean));

  // Etichetta di stato upload mostrata sotto ogni card.
  const uploadHint = (s: DocSlotState) => {
    if (s.status === 'uploading') return <p className="mt-1 text-[12px] text-pv-slate-500">Caricamento… {Math.round(s.progress)}%</p>;
    if (s.status === 'done') return <p className="mt-1 text-[12px] font-semibold text-pv-green-500">✓ Caricato</p>;
    if (s.status === 'error') return <p className="mt-1 text-[12px] font-semibold text-pv-red-500">{s.errorMsg}</p>;
    return null;
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {kycErrors.length > 0 && (
        <Alert variant="error" title="Verifica documenti non superata">
          <ul className="list-disc space-y-1 pl-5">
            {kycErrors.map((f, i) => (
              <li key={i}>{f.message}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Alert variant="info">
        Carica i documenti KYC dell&apos;amministratore e dell&apos;azienda. Formati
        ammessi: PDF, JPG, PNG (max 10 MB per file).
      </Alert>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <DocCard
            label="Carta d'identità — Fronte"
            file={ciFronte.file}
            onChange={onDocChange('ciFronte')}
            invalid={failedDocs.has('CI') || ciFronte.status === 'error'}
          />
          {uploadHint(ciFronte)}
        </div>
        <div>
          <DocCard
            label="Carta d'identità — Retro"
            file={ciRetro.file}
            onChange={onDocChange('ciRetro')}
            invalid={failedDocs.has('CI') || ciRetro.status === 'error'}
          />
          {uploadHint(ciRetro)}
        </div>
        <div>
          <DocCard
            label="Codice Fiscale / Tessera Sanitaria"
            file={codiceFiscale.file}
            onChange={onDocChange('codiceFiscale')}
            invalid={failedDocs.has('CF') || codiceFiscale.status === 'error'}
          />
          {uploadHint(codiceFiscale)}
        </div>
        <div>
          <DocCard
            label="Visura Camerale"
            file={visuraCamerale.file}
            onChange={onDocChange('visuraCamerale')}
            invalid={failedDocs.has('VISURA') || visuraCamerale.status === 'error'}
          />
          {uploadHint(visuraCamerale)}
        </div>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <Button type="button" variant="secondary" onClick={onBack} className="sm:w-auto" disabled={isVerifying}>
          Indietro
        </Button>
        <Button
          type="submit"
          disabled={!validation.ok || isVerifying}
          loading={isVerifying}
          loadingLabel="Verifica documenti in corso…"
          className="sm:flex-1"
        >
          Avanti
        </Button>
      </div>
    </form>
  );
}

// ============================================================
// STEP 4 - PAGAMENTO + T&C
// ============================================================

function PaymentStep({
  defaultValues,
  onBack,
  onSubmit,
  isSubmitting,
}: {
  defaultValues?: PaymentData;
  onBack: () => void;
  onSubmit: (data: PaymentData, promoCode: string) => void;
  isSubmitting: boolean;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<PaymentData>({
    resolver: zodResolver(registerStep4PaymentSchema),
    defaultValues,
    mode: 'onChange',
  });

  const [promoCode, setPromoCode] = useState('');
  const [promoState, setPromoState] = useState<PromoCheckResult | null>(null);
  const [checkingPromo, setCheckingPromo] = useState(false);

  const applyPromo = async () => {
    if (!promoCode.trim()) return;
    setCheckingPromo(true);
    try {
      setPromoState(await checkPromoCodeAction(promoCode));
    } finally {
      setCheckingPromo(false);
    }
  };

  const promoMessage = (): { text: string; ok: boolean } | null => {
    if (!promoState) return null;
    if (promoState.stato === 'valido')
      return { ok: true, text: `Codice valido: ${formatCurrencyCent(promoState.amountCent)} verranno accreditati sul tuo wallet.` };
    if (promoState.stato === 'scaduto') return { ok: false, text: 'Codice scaduto.' };
    if (promoState.stato === 'esaurito') return { ok: false, text: 'Codice non più disponibile.' };
    return { ok: false, text: 'Codice inesistente.' };
  };

  return (
    <form onSubmit={handleSubmit((v) => onSubmit(v, promoCode))} className="space-y-4">
      <Field label="IBAN" required error={errors.iban?.message}>
        <Input
          invalid={!!errors.iban}
          placeholder="IT60X0542811101000000123456"
          {...register('iban')}
        />
      </Field>

      <Alert variant="info">
        Il mandato SEPA reale verrà attivato in Fase 5 tramite Stripe. Per ora salviamo solo
        l&apos;accettazione.
      </Alert>

      <Field label="Codice promozionale (opzionale)">
        <div className="flex gap-2">
          <Input
            value={promoCode}
            onChange={(e) => {
              setPromoCode(e.target.value);
              setPromoState(null);
            }}
            placeholder="Es. BENVENUTO"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={applyPromo}
            loading={checkingPromo}
            className="shrink-0"
          >
            Applica
          </Button>
        </div>
      </Field>
      {promoMessage() && (
        <p className={`text-[13px] font-medium ${promoMessage()!.ok ? 'text-pv-green-500' : 'text-pv-red-500'}`}>
          {promoMessage()!.text}
        </p>
      )}

      <label className="flex items-start gap-2.5 text-[13px] text-pv-slate-700">
        <Checkbox {...register('sepaMandateAccepted')} className="mt-0.5" />
        <span>
          Autorizzo Passaggio Veloce a effettuare accrediti automatici sul conto indicato per
          l’erogazione dei compensi maturati sulla piattaforma.
          <span className="ml-1 text-pv-orange-500" aria-hidden="true">
            •
          </span>
        </span>
      </label>
      {errors.sepaMandateAccepted && (
        <p className="text-xs font-medium text-pv-red-500">
          {errors.sepaMandateAccepted.message}
        </p>
      )}

      <label className="flex items-start gap-2.5 text-[13px] text-pv-slate-700">
        <Checkbox {...register('termsAccepted')} className="mt-0.5" />
        <span>
          Ho letto e accetto i Termini e Condizioni e l&apos;Informativa Privacy di Passaggio
          Veloce.
          <span className="ml-1 text-pv-orange-500" aria-hidden="true">
            •
          </span>
        </span>
      </label>
      {errors.termsAccepted && (
        <p className="text-xs font-medium text-pv-red-500">{errors.termsAccepted.message}</p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <Button type="button" variant="secondary" onClick={onBack} className="sm:w-auto">
          Indietro
        </Button>
        <Button
          type="submit"
          disabled={!isValid}
          loading={isSubmitting}
          loadingLabel="Verifica documenti in corso…"
          className="sm:flex-1"
        >
          Completa registrazione
        </Button>
      </div>
    </form>
  );
}
