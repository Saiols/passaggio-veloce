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
import { Alert, Button, Checkbox, Field, Input, Select } from '@/components/ui';
import { WizardProgress } from '@/components/wizard-progress';
import { validateRegistrationDocuments } from '@/lib/auth/document-validation';
import { registerAction } from '../actions';

type AccountData = z.infer<typeof registerStep1AccountSchema>;
type CompanyData = z.infer<typeof registerStep2CompanySchema>;
type PaymentData = z.infer<typeof registerStep4PaymentSchema>;

type DocumentsData = {
  ciFronte: File;
  ciRetro: File;
  codiceFiscale: File;
  visuraCamerale: File;
  visuraData: string; // ISO yyyy-mm-dd
};

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
  const [token, setToken] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleAccount = (values: AccountData) => {
    setData((d) => ({ ...d, account: values }));
    setStep(2);
  };

  const handleCompany = (values: CompanyData) => {
    setData((d) => ({ ...d, company: values }));
    setStep(3);
  };

  const handleDocuments = (values: DocumentsData) => {
    setData((d) => ({ ...d, documents: values }));
    setStep(4);
  };

  const handlePayment = (values: PaymentData) => {
    setData((d) => ({ ...d, payment: values }));
    if (!data.account || !data.company || !data.documents) {
      setSubmitError('Dati mancanti, ricomincia il wizard');
      setStep(1);
      return;
    }

    setSubmitError(null);
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
          visuraData: docs.visuraData,
        }),
      );
      fd.set('CI_FRONTE', docs.ciFronte);
      fd.set('CI_RETRO', docs.ciRetro);
      fd.set('CODICE_FISCALE', docs.codiceFiscale);
      fd.set('VISURA_CAMERALE', docs.visuraCamerale);

      const result = await registerAction(fd);

      if (result.ok) {
        setToken(result.emailVerificationToken);
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
              onBack={() => setStep(2)}
              onNext={handleDocuments}
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
          <Input
            type="password"
            autoComplete="new-password"
            invalid={!!errors.password}
            {...register('password')}
          />
        </Field>
        <Field label="Conferma password" required error={errors.passwordConfirm?.message}>
          <Input
            type="password"
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
    formState: { errors, isValid },
  } = useForm<CompanyData>({
    resolver: zodResolver(registerStep2CompanySchema),
    defaultValues: forcedCompanyType
      ? { ...defaultValues, type: forcedCompanyType }
      : defaultValues,
    mode: 'onChange',
  });

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
        <Field label="Codice SDI" hint="Opzionale" error={errors.codiceSdi?.message}>
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
        <Field label="Telefono" hint="Opzionale" error={errors.telefono?.message}>
          <Input invalid={!!errors.telefono} {...register('telefono')} />
        </Field>
      </div>

      <Field label="Indirizzo" required error={errors.indirizzo?.message}>
        <Input invalid={!!errors.indirizzo} {...register('indirizzo')} />
      </Field>

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

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/jpg';

function DocFileInput({
  label,
  file,
  onChange,
}: {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
}) {
  const inputId = `doc-file-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  return (
    <Field label={label} required htmlFor={inputId}>
      <input
        id={inputId}
        type="file"
        accept={ACCEPT}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-pv-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-pv-navy-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-pv-navy-700"
      />
      {file && (
        <p className="mt-1 text-xs text-pv-slate-500">
          {file.name} — {(file.size / 1024 / 1024).toFixed(2)} MB
        </p>
      )}
    </Field>
  );
}

function DocumentsStep({
  defaultValues,
  onBack,
  onNext,
}: {
  defaultValues?: DocumentsData;
  onBack: () => void;
  onNext: (data: DocumentsData) => void;
}) {
  const [ciFronte, setCiFronte] = useState<File | null>(defaultValues?.ciFronte ?? null);
  const [ciRetro, setCiRetro] = useState<File | null>(defaultValues?.ciRetro ?? null);
  const [codiceFiscale, setCodiceFiscale] = useState<File | null>(
    defaultValues?.codiceFiscale ?? null,
  );
  const [visuraCamerale, setVisuraCamerale] = useState<File | null>(
    defaultValues?.visuraCamerale ?? null,
  );
  const [visuraData, setVisuraData] = useState<string>(defaultValues?.visuraData ?? '');
  const [error, setError] = useState<string | null>(null);

  const validation = useMemo(() => {
    if (!(ciFronte && ciRetro && codiceFiscale && visuraCamerale) || !visuraData) {
      return { ok: false as const, error: 'Carica tutti i documenti e indica la data della visura' };
    }
    return validateRegistrationDocuments(
      [
        { tipo: 'CI_FRONTE', mimeType: ciFronte.type, sizeBytes: ciFronte.size, originalFilename: ciFronte.name },
        { tipo: 'CI_RETRO', mimeType: ciRetro.type, sizeBytes: ciRetro.size, originalFilename: ciRetro.name },
        { tipo: 'CODICE_FISCALE', mimeType: codiceFiscale.type, sizeBytes: codiceFiscale.size, originalFilename: codiceFiscale.name },
        { tipo: 'VISURA_CAMERALE', mimeType: visuraCamerale.type, sizeBytes: visuraCamerale.size, originalFilename: visuraCamerale.name },
      ],
      visuraData,
    );
  }, [ciFronte, ciRetro, codiceFiscale, visuraCamerale, visuraData]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setError(null);
    onNext({
      ciFronte: ciFronte!,
      ciRetro: ciRetro!,
      codiceFiscale: codiceFiscale!,
      visuraCamerale: visuraCamerale!,
      visuraData,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Alert variant="info">
        Carica i documenti KYC dell&apos;amministratore e dell&apos;azienda. Formati
        ammessi: PDF, JPG, PNG (max 10 MB per file).
      </Alert>

      <DocFileInput label="Carta d'identità — Fronte" file={ciFronte} onChange={setCiFronte} />
      <DocFileInput label="Carta d'identità — Retro" file={ciRetro} onChange={setCiRetro} />
      <DocFileInput
        label="Codice Fiscale / Tessera Sanitaria"
        file={codiceFiscale}
        onChange={setCodiceFiscale}
      />
      <DocFileInput label="Visura Camerale" file={visuraCamerale} onChange={setVisuraCamerale} />

      <Field label="Data emissione visura" required>
        <Input
          type="date"
          value={visuraData}
          onChange={(e) => setVisuraData(e.target.value)}
        />
      </Field>

      {error && <Alert variant="error">{error}</Alert>}

      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <Button type="button" variant="secondary" onClick={onBack} className="sm:w-auto">
          Indietro
        </Button>
        <Button type="submit" disabled={!validation.ok} className="sm:flex-1">
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
  onSubmit: (data: PaymentData) => void;
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

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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

      <label className="flex items-start gap-2.5 text-[13px] text-pv-slate-700">
        <Checkbox {...register('sepaMandateAccepted')} className="mt-0.5" />
        <span>
          Autorizzo l&apos;addebito automatico SEPA per i pagamenti delle pratiche e per gli
          auto-addebiti previsti dai Termini.
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
          loadingLabel="Registrazione…"
          className="sm:flex-1"
        >
          Completa registrazione
        </Button>
      </div>
    </form>
  );
}
