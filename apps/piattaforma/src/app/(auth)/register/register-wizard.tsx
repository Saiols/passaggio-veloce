'use client';

import { useState, useMemo, useTransition, useEffect, useLayoutEffect, useRef, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import {
  registerStep1AccountSchema,
  registerStep2CompanySchema,
  registerStep4PaymentSchema,
  registerSedeSchema,
} from '@/lib/auth/schemas';
import { useFieldErrorsState, zodFieldErrors } from '@/components/forms';
import { Alert, Button, Checkbox, Field, Input, Modal, PasswordInput, Select } from '@/components/ui';
import { AddressAutocomplete, type AddressParts } from '@/components/address-autocomplete';
import { WizardProgress } from '@/components/wizard-progress';
import { DocCard } from '@/components/doc-card';
import { validateRegistrationDocuments } from '@/lib/auth/document-validation';
import {
  registerAction,
  checkPromoCodeAction,
  verifyRegistrationDocumentsAction,
  type RoutableRegisterField,
} from '../actions';
import type { PromoCheckResult } from '@/lib/promo/evaluate';
import { formatCurrencyCent } from '@/lib/format';
import { uploadToBlob, type BlobRef } from '@/lib/blob/upload-client';
import { elencoClausoleVessatorie, elencoDescrizioniVessatorie } from '@/lib/legal/clausole-vessatorie';
import { VISURA_VALIDITA_GIORNI } from '@/lib/visura/validita';
import {
  REGISTER_DRAFT_KEY,
  parseRegisterDraft,
  serializeRegisterDraft,
} from './register-draft';

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
  codiceFiscaleRetro: BlobRef;
  visuraCamerale: BlobRef;
};

/**
 * Esito di blocco KYC per singolo documento (mirror del tipo server-side
 * `KycFailure` in @/lib/kyc/verify, che però è `server-only`: qui ne teniamo
 * la forma minimale usata in UI per evitare l'import del modulo server).
 */
type KycFailureUi = { doc?: 'CI' | 'CF' | 'VISURA'; message: string };

/** Una sede operativa definita in registrazione (multi-sede). */
type SedeInput = {
  nome: string;
  indirizzo: string;
  civico: string;
  citta: string;
  cap: string;
  provincia: string;
  telefono: string;
  email: string;
  iban: string;
};

type WizardData = {
  account?: AccountData;
  company?: CompanyData;
  documents?: DocumentsData;
  payment?: PaymentData;
  sedi?: SedeInput[];
};

/** Forma dello stato persistito in bozza (sessionStorage). I File non sono
 * serializzabili: di `documents` si salvano solo le BlobRef (dentro `data`). */
type PersistedRegisterDraft = {
  step: number;
  data: WizardData;
  kycToken: string | null;
  docsVerified: boolean;
  pendingPromoCode: string;
};

const STEPS = [
  { id: 1, label: 'Account', title: 'Crea il tuo account', hint: 'Inserisci i dati del titolare o del responsabile dell\'account. Questi dati identificano la persona fisica che gestisce il profilo sulla piattaforma.' },
  { id: 2, label: 'Azienda', title: 'Dati azienda', hint: 'Ragione sociale, partita IVA, sede legale e contatti.' },
  { id: 3, label: 'Documenti', title: 'Documenti richiesti', hint: 'CI, codice fiscale e visura camerale per la verifica KYC.' },
  { id: 4, label: 'Pagamento', title: 'Pagamento e condizioni', hint: 'IBAN per il mandato SEPA e accettazione dei Termini.' },
  { id: 5, label: 'Sedi', title: 'Le tue sedi', hint: 'Definisci le sedi operative (agenzie/punti). Se ne hai una sola, è già pronta dai dati azienda: clicca Completa.' },
] as const;

/**
 * Instrada l'errore di un campo server-side — rilevato SOLO al submit finale
 * (step Sedi), sia dal check applicativo sia dal catch P2002 della race
 * TOCTOU — verso lo step che possiede quel campo, così l'utente lo vede lì
 * invece che come banner generico sullo step Sedi. Chiave = `field`
 * restituito da `registerAction` (vedi RegisterActionResult in ../actions).
 *
 * Aggiungere un nuovo campo instradabile = una entry qui + il relativo prop
 * `xxxError`/`useEffect(setError(...))` nello step che lo possiede (stesso
 * pattern di `emailError` in AccountStep e `partitaIvaError` in CompanyStep).
 *
 * Tipizzata su `RoutableRegisterField` (importato da `../actions`): le chiavi
 * qui e i `field` letterali che il server restituisce si controllano a
 * vicenda col typecheck, non solo via questo commento.
 */
const ROUTABLE_FIELD_STEP: Record<RoutableRegisterField, number> = {
  'account.email': 1,
  'company.partitaIva': 2,
};

/** Type guard su `ROUTABLE_FIELD_STEP`: usa `Object.hasOwn` (non `in`, che
 * cammina anche sulla catena dei prototipi) per restringere il `field`
 * generico del server a `RoutableRegisterField` prima di indicizzare la mappa. */
function isRoutableField(field: string): field is RoutableRegisterField {
  return Object.hasOwn(ROUTABLE_FIELD_STEP, field);
}

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
  const initialPromoCode = searchParams.get('promo') ?? undefined;
  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>(
    forcedCompanyType
      ? { company: { type: forcedCompanyType } as CompanyData }
      : {},
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Errore di un campo server-side (es. email o P.IVA già in uso): il submit
  // finale avviene allo step Sedi, ma l'utente deve vederlo sullo step e sul
  // campo che lo possiede, non come banner generico in fondo alla pagina.
  // Instradato via ROUTABLE_FIELD_STEP, vedi lì.
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [kycErrors, setKycErrors] = useState<KycFailureUi[]>([]);
  // Cache verifica documenti: evita di ri-chiamare l'OCR su Back→Avanti senza
  // modifiche. `kycToken` viene passato al submit per non ri-fare l'OCR lì.
  const [kycToken, setKycToken] = useState<string | null>(null);
  const [docsVerified, setDocsVerified] = useState(false);
  // Giorni della visura appena verificata: >= VISURA_VALIDITA_GIORNI → avviso
  // "già da aggiornare" (non blocca: il wizard avanza comunque).
  const [visuraGiorni, setVisuraGiorni] = useState<number | null>(null);
  const [token, setToken] = useState<string | null>(null);
  // Successo registrazione: apre la modale di conferma + CTA login. In prod è
  // l'UNICA UX di successo (il box "DEMO" col token esiste solo in DEMO_MODE).
  const [registered, setRegistered] = useState(false);
  const [promoOutcome, setPromoOutcome] = useState<
    { applied: true; amountCent: number } | { applied: false } | null
  >(null);
  const [pendingPromoCode, setPendingPromoCode] = useState('');
  const [isPending, startTransition] = useTransition();
  const [isVerifyingDocs, startVerifyDocs] = useTransition();

  // Oggetti File dei documenti KYC, tenuti nel genitore così — tornando INDIETRO
  // allo step Documenti — le miniature ricompaiono (i File non sopravvivono allo
  // smontaggio dello step, le BlobRef in `data.documents` sì). Non serializzabili
  // → non persistiti: dopo un refresh la card mostra "Caricato" senza miniatura.
  const [docFiles, setDocFiles] = useState<Partial<Record<SlotKey, File | null>>>({});

  // --- Persistenza bozza (sessionStorage): sopravvive al refresh accidentale, si
  // azzera chiudendo la scheda. Include la password dello step Account → mai in
  // localStorage. Forma versionata/scaduta gestita nel modulo register-draft.
  const hydratedRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);

  // Ripristino PRIMA del paint (niente flash dello stato vuoto). Una bozza
  // corrotta/di versione vecchia viene semplicemente ignorata dal parser.
  useLayoutEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    try {
      const d = parseRegisterDraft(sessionStorage.getItem(REGISTER_DRAFT_KEY), Date.now()) as
        | Partial<PersistedRegisterDraft>
        | null;
      if (d) {
        if (d.data) {
          setData(
            forcedCompanyType
              ? { ...d.data, company: { ...(d.data.company ?? {}), type: forcedCompanyType } as CompanyData }
              : d.data,
          );
        }
        if (typeof d.step === 'number') setStep(d.step);
        if (typeof d.kycToken === 'string') setKycToken(d.kycToken);
        if (typeof d.docsVerified === 'boolean') setDocsVerified(d.docsVerified);
        if (typeof d.pendingPromoCode === 'string') setPendingPromoCode(d.pendingPromoCode);
      }
    } catch {
      /* bozza illeggibile: si parte puliti */
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Salvataggio debounced (solo dopo il ripristino, così non si sovrascrive con
  // lo stato iniziale vuoto). I File non si salvano: solo le BlobRef in `data`.
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      try {
        const draft: PersistedRegisterDraft = { step, data, kycToken, docsVerified, pendingPromoCode };
        sessionStorage.setItem(REGISTER_DRAFT_KEY, serializeRegisterDraft(draft, Date.now()));
      } catch {
        /* quota o serializzazione: la bozza è best-effort */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [hydrated, step, data, kycToken, docsVerified, pendingPromoCode]);

  const clearRegisterDraft = () => {
    try {
      sessionStorage.removeItem(REGISTER_DRAFT_KEY);
    } catch {
      /* ignore */
    }
  };

  const handleAccount = (values: AccountData) => {
    setData((d) => ({ ...d, account: values }));
    setFieldError(null);
    setStep(2);
  };

  const handleCompany = (values: CompanyData) => {
    setData((d) => ({ ...d, company: values }));
    setFieldError(null);
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
    // Anche l'avviso sull'età: era riferito alla visura PRECEDENTE. Sostituito il
    // file, lasciarlo appeso significherebbe mostrare i giorni di un documento
    // che non c'è più, finché l'utente non riclicca Avanti.
    setVisuraGiorni(null);
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
          CODICE_FISCALE_RETRO: values.codiceFiscaleRetro,
          VISURA_CAMERALE: values.visuraCamerale,
        }),
      );

      const res = await verifyRegistrationDocumentsAction(fd);
      if (res.ok) {
        setData((d) => ({ ...d, documents: values }));
        setKycToken(res.token ?? null);
        setDocsVerified(true);
        setVisuraGiorni(res.visuraGiorni ?? null);
        setStep(4);
      } else if (res.kycFailures && res.kycFailures.length > 0) {
        setKycErrors(res.kycFailures);
        setDocsVerified(false);
        setKycToken(null);
        setVisuraGiorni(null);
      } else {
        setSubmitError(res.error);
      }
    });
  };

  // Pagamento: salva i dati e avanza allo step Sedi (il submit finale è lì).
  const handlePayment = (values: PaymentData, promoCode: string) => {
    setData((d) => ({ ...d, payment: values }));
    setPendingPromoCode(promoCode);
    setSubmitError(null);
    setStep(5);
  };

  // Step Sedi → submit finale della registrazione (include le sedi definite).
  const handleSedi = (sedi: SedeInput[]) => {
    if (!data.account || !data.company || !data.documents || !data.payment) {
      setSubmitError('Dati mancanti, ricomincia il wizard');
      setStep(1);
      return;
    }
    setData((d) => ({ ...d, sedi }));
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
          payment: data.payment,
          sedi,
          referralCode,
          promoCode: pendingPromoCode,
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
          CODICE_FISCALE_RETRO: docs.codiceFiscaleRetro,
          VISURA_CAMERALE: docs.visuraCamerale,
        }),
      );

      const result = await registerAction(fd);

      if (result.ok) {
        clearRegisterDraft();
        // undefined fuori da DEMO_MODE (il server non espone più il token):
        // → `token` resta null → il box "Modalità DEMO" non viene renderizzato.
        setToken(result.emailVerificationToken ?? null);
        setPromoOutcome(result.promo ?? null);
        setRegistered(true); // apre la modale di conferma (unica UX di successo in prod)
      } else if (result.kycFailures && result.kycFailures.length > 0) {
        // Gate KYC non superato: torna allo step Documenti e mostra i motivi
        // di blocco per documento, così l'utente sa esattamente cosa correggere.
        setKycErrors(result.kycFailures);
        setStep(3);
      } else if (result.field && isRoutableField(result.field)) {
        // Campo già occupato (email o P.IVA — check applicativo o race TOCTOU
        // intercettata come P2002): torna allo step che possiede il campo e
        // mostra l'errore lì, non come banner generico sullo step Sedi.
        setFieldError({ field: result.field, message: result.error });
        setStep(ROUTABLE_FIELD_STEP[result.field]);
      } else {
        // Nessun campo instradabile (o assente): banner generico, mai
        // inghiottito in silenzio.
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
          {visuraGiorni !== null && visuraGiorni >= VISURA_VALIDITA_GIORNI && (
            <Alert variant="warning" title="Visura camerale da aggiornare">
              La visura che hai caricato è stata emessa <strong>{visuraGiorni} giorni fa</strong> e
              supera i {VISURA_VALIDITA_GIORNI} giorni di validità. Puoi completare la
              registrazione, ma dovrai aggiornarla subito dopo il primo accesso: fino ad allora{' '}
              {data.company?.type === 'DEALER'
                ? 'non potrai prelevare il saldo del tuo wallet'
                : 'non potrai gestire pratiche né riceverne di nuove'}
              . Se hai una visura più recente, torna allo step Documenti e sostituiscila.
            </Alert>
          )}
          {submitError && <Alert variant="error">{submitError}</Alert>}

          <Modal
            open={registered}
            onClose={() => {
              window.location.href = '/login';
            }}
            title="Registrazione completata 🎉"
          >
            <div className="space-y-3 text-[14px] leading-relaxed text-pv-slate-700">
              <p>
                Il tuo account è stato creato. Ti abbiamo inviato un&apos;email di verifica
                {data.account?.email ? (
                  <>
                    {' '}
                    a <strong>{data.account.email}</strong>
                  </>
                ) : null}
                .
              </p>
              <p>Verifica la tua email, poi accedi con le credenziali che hai scelto.</p>
              {promoOutcome?.applied === true && (
                <div className="rounded-lg border border-pv-green-500 bg-pv-green-50 p-3 text-pv-navy-900">
                  🎁 Promozione applicata:{' '}
                  <strong>{formatCurrencyCent(promoOutcome.amountCent)}</strong> accreditati sul
                  tuo wallet.
                </div>
              )}
              {token && (
                <p className="text-[12px] text-pv-slate-500">
                  (DEMO) Link di verifica:{' '}
                  <a
                    href={`/verify-email?token=${token}`}
                    className="break-all text-pv-navy-700 underline"
                  >
                    {`/verify-email?token=${token}`}
                  </a>
                </p>
              )}
              <a href="/login" className="mt-2 block">
                <Button fullWidth>Vai al login</Button>
              </a>
            </div>
          </Modal>

          {step === 1 && (
            <AccountStep
              defaultValues={data.account}
              onNext={handleAccount}
              emailError={fieldError?.field === 'account.email' ? fieldError.message : null}
            />
          )}
          {step === 2 && (
            <CompanyStep
              defaultValues={data.company}
              forcedCompanyType={forcedCompanyType}
              onBack={() => setStep(1)}
              onNext={handleCompany}
              partitaIvaError={
                fieldError?.field === 'company.partitaIva' ? fieldError.message : null
              }
            />
          )}
          {step === 3 && (
            <DocumentsStep
              defaultValues={data.documents}
              defaultFiles={docFiles}
              onFileChange={(k, f) => setDocFiles((m) => ({ ...m, [k]: f }))}
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
              companyType={data.company?.type}
              initialPromoCode={initialPromoCode}
              onBack={() => setStep(3)}
              onSubmit={handlePayment}
              isSubmitting={false}
            />
          )}
          {step === 5 && (
            <SediStep
              company={data.company}
              paymentIban={data.payment?.iban}
              defaultValues={data.sedi}
              onBack={() => setStep(4)}
              onSubmit={handleSedi}
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
  emailError,
}: {
  defaultValues?: AccountData;
  onNext: (data: AccountData) => void;
  /** Errore server-side (es. email già registrata) da mostrare sul campo email. */
  emailError?: string | null;
}) {
  // `dataNascita` è coerced a Date dallo schema; l'input type="date" vuole una
  // stringa yyyy-mm-dd, altrimenti al "Indietro" il campo resta vuoto.
  const formDefaults = defaultValues
    ? ({ ...defaultValues, dataNascita: toDateInputValue(defaultValues.dataNascita) } as unknown as AccountData)
    : undefined;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<AccountData>({
    resolver: zodResolver(registerStep1AccountSchema),
    defaultValues: formDefaults,
    mode: 'onChange',
  });

  // Arrivo da un submit finale (step Sedi) fallito per email già in uso:
  // porta l'errore sul campo, così l'utente lo vede dove deve correggerlo.
  useEffect(() => {
    if (emailError) {
      setError('email', { type: 'server', message: emailError });
    }
  }, [emailError, setError]);

  return (
    <form onSubmit={handleSubmit(onNext)} noValidate className="space-y-4">
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
        <Input
          invalid={!!errors.codiceFiscale}
          className="uppercase"
          {...register('codiceFiscale', {
            setValueAs: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
          })}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Data di nascita" required error={errors.dataNascita?.message}>
          <Input type="date" invalid={!!errors.dataNascita} {...register('dataNascita')} />
        </Field>
        <Field label="Luogo di nascita" required error={errors.luogoNascita?.message}>
          <Input invalid={!!errors.luogoNascita} {...register('luogoNascita')} />
        </Field>
      </div>

      <Button type="submit" fullWidth>
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
  partitaIvaError,
}: {
  defaultValues?: CompanyData;
  forcedCompanyType?: 'DEALER' | 'AGENZIA';
  onBack: () => void;
  onNext: (data: CompanyData) => void;
  /** Errore server-side (es. P.IVA già registrata) da mostrare sul campo P.IVA. */
  partitaIvaError?: string | null;
}) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors },
  } = useForm<CompanyData>({
    resolver: zodResolver(registerStep2CompanySchema),
    defaultValues: forcedCompanyType
      ? { ...defaultValues, type: forcedCompanyType }
      : defaultValues,
    mode: 'onChange',
  });

  // Il regime fiscale si chiede solo ai DEALER (i "broker" che maturano compensi):
  // determina il tipo di documento emesso per loro conto (TD01/TD06).
  const isDealer = (forcedCompanyType ?? watch('type')) === 'DEALER';

  // Arrivo da un submit finale (step Sedi) fallito per P.IVA già registrata:
  // porta l'errore sul campo, così l'utente lo vede dove deve correggerlo
  // (stesso meccanismo di `emailError` in AccountStep).
  useEffect(() => {
    if (partitaIvaError) {
      setError('partitaIva', { type: 'server', message: partitaIvaError });
    }
  }, [partitaIvaError, setError]);

  const applyAddress = (p: AddressParts) => {
    const opts = { shouldValidate: true, shouldDirty: true } as const;
    setValue('indirizzo', p.indirizzo, opts);
    setValue('civico', p.civico, opts);
    setValue('citta', p.citta, opts);
    setValue('cap', p.cap, opts);
    setValue('provincia', p.provincia, opts);
  };

  return (
    <form onSubmit={handleSubmit(onNext)} noValidate className="space-y-4">
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

      {isDealer && (
        <Field
          label="Regime fiscale"
          required
          error={errors.regimeFiscale?.message}
          hint="Determina come vengono emessi i documenti dei tuoi compensi (con o senza IVA)."
        >
          <Select invalid={!!errors.regimeFiscale} {...register('regimeFiscale')} defaultValue="">
            <option value="" disabled>
              Seleziona...
            </option>
            <option value="ORDINARIO">Ordinario (con IVA 22%)</option>
            <option value="FORFETTARIO">Forfettario (senza IVA, L. 190/2014)</option>
          </Select>
        </Field>
      )}

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
        <Button type="submit" className="sm:flex-1">
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

type SlotKey = 'ciFronte' | 'ciRetro' | 'codiceFiscale' | 'codiceFiscaleRetro' | 'visuraCamerale';

const SLOT_TIPO: Record<
  SlotKey,
  'CI_FRONTE' | 'CI_RETRO' | 'CODICE_FISCALE' | 'CODICE_FISCALE_RETRO' | 'VISURA_CAMERALE'
> = {
  ciFronte: 'CI_FRONTE',
  ciRetro: 'CI_RETRO',
  codiceFiscale: 'CODICE_FISCALE',
  codiceFiscaleRetro: 'CODICE_FISCALE_RETRO',
  visuraCamerale: 'VISURA_CAMERALE',
};

function DocumentsStep({
  defaultValues,
  defaultFiles,
  onFileChange,
  kycErrors,
  onDocsChanged,
  onBack,
  onNext,
  isVerifying,
}: {
  defaultValues?: DocumentsData;
  /** File già selezionati, tenuti dal genitore: ripristinano la miniatura quando
   * si torna indietro a questo step (le BlobRef non bastano per l'anteprima). */
  defaultFiles?: Partial<Record<SlotKey, File | null>>;
  /** Notifica al genitore il File scelto/rimosso, così la miniatura sopravvive
   * allo smontaggio dello step (Indietro/Avanti). */
  onFileChange?: (key: SlotKey, file: File | null) => void;
  kycErrors: KycFailureUi[];
  onDocsChanged: () => void;
  onBack: () => void;
  onNext: (data: DocumentsData) => void;
  isVerifying: boolean;
}) {
  // defaultValues contiene le BlobRef (file già caricati in un passaggio
  // precedente del wizard): ripristiniamo lo stato "done". Il File, se ancora in
  // memoria (defaultFiles dal genitore), riabilita la miniatura; dopo un refresh
  // non c'è più ma la ref basta per mostrare "Caricato".
  const fromRef = (key: SlotKey, ref?: BlobRef): DocSlotState =>
    ref ? { file: defaultFiles?.[key] ?? null, ref, status: 'done', progress: 100 } : EMPTY_SLOT;

  const [ciFronte, setCiFronte] = useState<DocSlotState>(fromRef('ciFronte', defaultValues?.ciFronte));
  const [ciRetro, setCiRetro] = useState<DocSlotState>(fromRef('ciRetro', defaultValues?.ciRetro));
  const [codiceFiscale, setCodiceFiscale] = useState<DocSlotState>(
    fromRef('codiceFiscale', defaultValues?.codiceFiscale),
  );
  const [codiceFiscaleRetro, setCodiceFiscaleRetro] = useState<DocSlotState>(
    fromRef('codiceFiscaleRetro', defaultValues?.codiceFiscaleRetro),
  );
  const [visuraCamerale, setVisuraCamerale] = useState<DocSlotState>(
    fromRef('visuraCamerale', defaultValues?.visuraCamerale),
  );
  const [error, setError] = useState<string | null>(null);

  const slots: Record<SlotKey, DocSlotState> = {
    ciFronte,
    ciRetro,
    codiceFiscale,
    codiceFiscaleRetro,
    visuraCamerale,
  };
  const setters: Record<SlotKey, (s: DocSlotState) => void> = {
    ciFronte: setCiFronte,
    ciRetro: setCiRetro,
    codiceFiscale: setCodiceFiscale,
    codiceFiscaleRetro: setCodiceFiscaleRetro,
    visuraCamerale: setVisuraCamerale,
  };

  // Validazione rule-based sulle ref caricate (mime/size dei file su Blob).
  const validation = useMemo(() => {
    const keys: SlotKey[] = ['ciFronte', 'ciRetro', 'codiceFiscale', 'codiceFiscaleRetro', 'visuraCamerale'];
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
  }, [ciFronte, ciRetro, codiceFiscale, codiceFiscaleRetro, visuraCamerale]);

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
      codiceFiscaleRetro: codiceFiscaleRetro.ref!,
      visuraCamerale: visuraCamerale.ref!,
    });
  };

  // Selezione/sostituzione di un documento: invalida la verifica precedente e
  // avvia subito l'upload diretto su Blob, aggiornando progress e stato. La ref
  // ottenuta è ciò che verrà inviato alle Server Action (niente File nel body).
  const onDocChange = (key: SlotKey) => async (f: File | null) => {
    onDocsChanged();
    onFileChange?.(key, f); // bubble al genitore: la miniatura sopravvive al Back
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

  // Etichetta di stato upload mostrata sotto ogni card. NB: lo stato "done" NON si
  // ripete qui — il badge "✓ Caricato" è già dentro la DocCard (era ridondante).
  // Restano solo i transitori: avanzamento upload ed errore.
  const uploadHint = (s: DocSlotState) => {
    if (s.status === 'uploading') return <p className="mt-1 text-[12px] text-pv-slate-500">Caricamento… {Math.round(s.progress)}%</p>;
    if (s.status === 'error') return <p className="mt-1 text-[12px] font-semibold text-pv-red-500">{s.errorMsg}</p>;
    return null;
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
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
            uploaded={ciFronte.status === 'done'}
            uploadedName={ciFronte.ref?.name}
            uploadedIsPdf={ciFronte.ref?.type === 'application/pdf'}
            onChange={onDocChange('ciFronte')}
            invalid={failedDocs.has('CI') || ciFronte.status === 'error'}
          />
          {uploadHint(ciFronte)}
        </div>
        <div>
          <DocCard
            label="Carta d'identità — Retro"
            file={ciRetro.file}
            uploaded={ciRetro.status === 'done'}
            uploadedName={ciRetro.ref?.name}
            uploadedIsPdf={ciRetro.ref?.type === 'application/pdf'}
            onChange={onDocChange('ciRetro')}
            invalid={failedDocs.has('CI') || ciRetro.status === 'error'}
          />
          {uploadHint(ciRetro)}
        </div>
        <div>
          <DocCard
            label="Codice Fiscale / Tessera Sanitaria"
            file={codiceFiscale.file}
            uploaded={codiceFiscale.status === 'done'}
            uploadedName={codiceFiscale.ref?.name}
            uploadedIsPdf={codiceFiscale.ref?.type === 'application/pdf'}
            onChange={onDocChange('codiceFiscale')}
            invalid={failedDocs.has('CF') || codiceFiscale.status === 'error'}
          />
          {uploadHint(codiceFiscale)}
        </div>
        <div>
          <DocCard
            label="Codice Fiscale / Tessera Sanitaria — Retro"
            file={codiceFiscaleRetro.file}
            uploaded={codiceFiscaleRetro.status === 'done'}
            uploadedName={codiceFiscaleRetro.ref?.name}
            uploadedIsPdf={codiceFiscaleRetro.ref?.type === 'application/pdf'}
            onChange={onDocChange('codiceFiscaleRetro')}
            invalid={failedDocs.has('CF') || codiceFiscaleRetro.status === 'error'}
          />
          {uploadHint(codiceFiscaleRetro)}
        </div>
        <div>
          <DocCard
            label="Visura Camerale"
            file={visuraCamerale.file}
            uploaded={visuraCamerale.status === 'done'}
            uploadedName={visuraCamerale.ref?.name}
            uploadedIsPdf={visuraCamerale.ref?.type === 'application/pdf'}
            pdfOnly
            subtitle="La visura camerale deve essere in formato PDF. Scaricala dal Registro Imprese e caricala qui."
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
          disabled={isVerifying}
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
  companyType,
  initialPromoCode,
  onBack,
  onSubmit,
  isSubmitting,
}: {
  defaultValues?: PaymentData;
  companyType?: 'DEALER' | 'AGENZIA';
  initialPromoCode?: string;
  onBack: () => void;
  onSubmit: (data: PaymentData, promoCode: string) => void;
  isSubmitting: boolean;
}) {
  const isAgenzia = companyType === 'AGENZIA';
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PaymentData>({
    resolver: zodResolver(registerStep4PaymentSchema),
    defaultValues,
    mode: 'onChange',
  });

  const [promoCode, setPromoCode] = useState(initialPromoCode ?? '');
  const [promoState, setPromoState] = useState<PromoCheckResult | null>(null);
  const [checkingPromo, setCheckingPromo] = useState(false);

  // Auto-apply: se arriviamo dal link /i/<token> con ?promo=, validiamo subito
  // così il credito risulta già applicato senza click.
  useEffect(() => {
    if (!initialPromoCode) return;
    let alive = true;
    setCheckingPromo(true);
    checkPromoCodeAction(initialPromoCode)
      .then((s) => { if (alive) setPromoState(s); })
      .finally(() => { if (alive) setCheckingPromo(false); });
    return () => { alive = false; };
  }, [initialPromoCode]);

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
    <form onSubmit={handleSubmit((v) => onSubmit(v, promoCode))} noValidate className="space-y-4">
      <Field label="IBAN" required error={errors.iban?.message}>
        <Input
          invalid={!!errors.iban}
          placeholder="IT60X0542811101000000123456"
          {...register('iban')}
        />
      </Field>

      <Alert variant="info">
        {isAgenzia
          ? 'Inserendo l’IBAN e accettando il mandato autorizzi gli addebiti SEPA per gli importi delle pratiche.'
          : 'L’IBAN sarà usato per accreditare i compensi maturati sulla piattaforma.'}
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
          {isAgenzia
            ? 'Autorizzo Passaggio Veloce S.r.l. ad addebitare il mio conto tramite addebito diretto SEPA (SEPA Direct Debit) per gli importi delle pratiche completate, secondo le condizioni del servizio. Il mandato è revocabile secondo lo standard SDD.'
            : 'Autorizzo Passaggio Veloce a effettuare accrediti automatici sul conto indicato per l’erogazione dei compensi maturati sulla piattaforma.'}
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
          Ho letto e accetto i{' '}
          <a
            href="/termini"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-pv-navy-700 underline hover:text-pv-navy-800"
          >
            Termini e Condizioni
          </a>{' '}
          e l&apos;
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-pv-navy-700 underline hover:text-pv-navy-800"
          >
            Informativa Privacy
          </a>{' '}
          di Passaggio Veloce.
          <span className="ml-1 text-pv-orange-500" aria-hidden="true">
            •
          </span>
        </span>
      </label>
      {errors.termsAccepted && (
        <p className="text-xs font-medium text-pv-red-500">{errors.termsAccepted.message}</p>
      )}

      {/* Approvazione specifica ex artt. 1341-1342 c.c. delle clausole vessatorie. */}
      <label className="flex items-start gap-2.5 text-[13px] text-pv-slate-700">
        <Checkbox {...register('clausoleVessatorieAccepted')} className="mt-0.5" />
        <span>
          Ai sensi degli artt. 1341-1342 c.c. approvo specificamente le clausole nn.{' '}
          {elencoClausoleVessatorie()} dei{' '}
          <a
            href="/termini"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-pv-navy-700 underline hover:text-pv-navy-800"
          >
            Termini e Condizioni
          </a>{' '}
          ({elencoDescrizioniVessatorie()}).
          <span className="ml-1 text-pv-orange-500" aria-hidden="true">
            •
          </span>
        </span>
      </label>
      {errors.clausoleVessatorieAccepted && (
        <p className="text-xs font-medium text-pv-red-500">
          {errors.clausoleVessatorieAccepted.message}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <Button type="button" variant="secondary" onClick={onBack} className="sm:w-auto">
          Indietro
        </Button>
        <Button
          type="submit"
          loading={isSubmitting}
          className="sm:flex-1"
        >
          Avanti
        </Button>
      </div>
    </form>
  );
}

// ============================================================
// STEP 5 - SEDI (multi-sede)
// ============================================================

const EMPTY_SEDE: SedeInput = {
  nome: '',
  indirizzo: '',
  civico: '',
  citta: '',
  cap: '',
  provincia: '',
  telefono: '',
  email: '',
  iban: '',
};

function SediStep({
  company,
  paymentIban,
  defaultValues,
  onBack,
  onSubmit,
  isSubmitting,
}: {
  company?: CompanyData;
  paymentIban?: string;
  defaultValues?: SedeInput[];
  onBack: () => void;
  onSubmit: (sedi: SedeInput[]) => void;
  isSubmitting: boolean;
}) {
  // La prima sede è pre-compilata dai dati azienda (caso 1 sola sede → UX invariata).
  const firstFromCompany: SedeInput = {
    ...EMPTY_SEDE,
    nome: company?.ragioneSociale ?? '',
    indirizzo: company?.indirizzo ?? '',
    civico: company?.civico ?? '',
    citta: company?.citta ?? '',
    cap: company?.cap ?? '',
    provincia: company?.provincia ?? '',
    telefono: company?.telefono ?? '',
    email: company?.email ?? '',
    iban: paymentIban ?? '',
  };
  const [sedi, setSedi] = useState<SedeInput[]>(
    defaultValues && defaultValues.length > 0 ? defaultValues : [firstFromCompany],
  );

  const update = (i: number, field: keyof SedeInput, value: string) => {
    setSedi((arr) => arr.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));
  };
  const addSede = () => setSedi((arr) => [...arr, { ...EMPTY_SEDE }]);
  const removeSede = (i: number) => setSedi((arr) => arr.filter((_, idx) => idx !== i));
  const applyAddress = (i: number, p: AddressParts) =>
    setSedi((arr) =>
      arr.map((s, idx) =>
        idx === i
          ? { ...s, indirizzo: p.indirizzo, civico: p.civico, citta: p.citta, cap: p.cap, provincia: p.provincia }
          : s,
      ),
    );

  // Errori per-sede con chiave namespaced `${i}:${campo}`: riusa lo schema sede
  // condiviso (stessi messaggi del server, nessuna divergenza).
  const errors: Record<string, string> = {};
  sedi.forEach((s, i) => {
    const e = zodFieldErrors(registerSedeSchema, s);
    for (const [k, v] of Object.entries(e)) errors[`${i}:${k}`] = v;
  });
  const { field: fieldErr, gatedSubmit } = useFieldErrorsState(errors);

  return (
    <form onSubmit={gatedSubmit(() => onSubmit(sedi))} noValidate className="space-y-4">
      <Alert variant="info">
        Definisci le sedi operative della tua azienda. Se ne hai una sola, è già pronta: clicca
        “Completa registrazione”. Puoi aggiungerne altre ora o in seguito dal pannello.
      </Alert>

      {sedi.map((s, i) => (
        <div key={i} className="rounded-2xl border border-pv-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[13px] font-bold text-pv-navy-800">
              Sede {i + 1}
              {i === 0 && <span className="ml-2 text-[11px] font-medium text-pv-slate-500">(dai dati azienda)</span>}
            </p>
            {sedi.length > 1 && (
              <button
                type="button"
                onClick={() => removeSede(i)}
                className="text-[12px] font-semibold text-pv-red-500 hover:underline"
              >
                Rimuovi
              </button>
            )}
          </div>
          <div className="mb-3">
            <AddressAutocomplete onSelect={(p) => applyAddress(i, p)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nome sede" required error={fieldErr(`${i}:nome`).error}>
              <Input
                value={s.nome}
                invalid={fieldErr(`${i}:nome`).invalid}
                onBlur={fieldErr(`${i}:nome`).onBlur}
                onChange={(e) => update(i, 'nome', e.target.value)}
              />
            </Field>
            <Field label="Indirizzo" required error={fieldErr(`${i}:indirizzo`).error}>
              <Input
                value={s.indirizzo}
                invalid={fieldErr(`${i}:indirizzo`).invalid}
                onBlur={fieldErr(`${i}:indirizzo`).onBlur}
                onChange={(e) => update(i, 'indirizzo', e.target.value)}
              />
            </Field>
            <Field label="Civico">
              <Input value={s.civico} onChange={(e) => update(i, 'civico', e.target.value)} />
            </Field>
            <Field label="Città" required error={fieldErr(`${i}:citta`).error}>
              <Input
                value={s.citta}
                invalid={fieldErr(`${i}:citta`).invalid}
                onBlur={fieldErr(`${i}:citta`).onBlur}
                onChange={(e) => update(i, 'citta', e.target.value)}
              />
            </Field>
            <Field label="CAP" required error={fieldErr(`${i}:cap`).error}>
              <Input
                value={s.cap}
                invalid={fieldErr(`${i}:cap`).invalid}
                onBlur={fieldErr(`${i}:cap`).onBlur}
                onChange={(e) => update(i, 'cap', e.target.value)}
              />
            </Field>
            <Field label="Provincia (sigla)" required error={fieldErr(`${i}:provincia`).error}>
              <Input
                maxLength={2}
                value={s.provincia}
                invalid={fieldErr(`${i}:provincia`).invalid}
                onBlur={fieldErr(`${i}:provincia`).onBlur}
                onChange={(e) => update(i, 'provincia', e.target.value)}
              />
            </Field>
            <Field label="Telefono">
              <Input value={s.telefono} onChange={(e) => update(i, 'telefono', e.target.value)} />
            </Field>
            <Field label="Email operativa">
              <Input value={s.email} onChange={(e) => update(i, 'email', e.target.value)} />
            </Field>
            <Field
              label="IBAN dedicato (opzionale, altrimenti quello aziendale)"
              error={fieldErr(`${i}:iban`).error}
            >
              <Input
                value={s.iban}
                invalid={fieldErr(`${i}:iban`).invalid}
                onBlur={fieldErr(`${i}:iban`).onBlur}
                placeholder="IT60X0542811101000000123456"
                onChange={(e) => update(i, 'iban', e.target.value)}
              />
            </Field>
          </div>
        </div>
      ))}

      <div className="flex justify-center">
        <button
          type="button"
          onClick={addSede}
          className="rounded-[10px] border-[1.5px] border-dashed border-pv-slate-300 px-4 py-2 text-[13px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
        >
          + Aggiungi un&apos;altra sede
        </button>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <Button type="button" variant="secondary" onClick={onBack} className="sm:w-auto" disabled={isSubmitting}>
          Indietro
        </Button>
        <Button type="submit" loading={isSubmitting} className="sm:flex-1">
          Completa registrazione
        </Button>
      </div>
    </form>
  );
}
