'use client';

import { useState, useTransition } from 'react';
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
import { registerAction } from '../actions';

type AccountData = z.infer<typeof registerStep1AccountSchema>;
type CompanyData = z.infer<typeof registerStep2CompanySchema>;
type PaymentData = z.infer<typeof registerStep4PaymentSchema>;

type WizardData = {
  account?: AccountData;
  company?: CompanyData;
  payment?: PaymentData;
};

const STEPS = [
  { id: 1, label: 'Account', title: 'Crea il tuo account', hint: 'Dati personali e credenziali di accesso alla piattaforma.' },
  { id: 2, label: 'Azienda', title: 'Dati azienda', hint: 'Ragione sociale, partita IVA, sede legale e contatti.' },
  { id: 3, label: 'Documenti', title: 'Documenti richiesti', hint: 'CI, codice fiscale e visura camerale per la verifica KYC.' },
  { id: 4, label: 'Pagamento', title: 'Pagamento e condizioni', hint: 'IBAN per il mandato SEPA e accettazione dei Termini.' },
] as const;

export function RegisterWizard() {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>({});
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

  const handleDocumentsSkip = () => setStep(4);

  const handlePayment = (values: PaymentData) => {
    setData((d) => ({ ...d, payment: values }));
    if (!data.account || !data.company) {
      setSubmitError('Dati mancanti, ricomincia il wizard');
      setStep(1);
      return;
    }

    setSubmitError(null);
    startTransition(async () => {
      const result = await registerAction({
        account: data.account!,
        company: data.company!,
        payment: values,
      });

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
              onBack={() => setStep(1)}
              onNext={handleCompany}
            />
          )}
          {step === 3 && (
            <DocumentsStep onBack={() => setStep(2)} onNext={handleDocumentsSkip} />
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

function AccountStep({
  defaultValues,
  onNext,
}: {
  defaultValues?: AccountData;
  onNext: (data: AccountData) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<AccountData>({
    resolver: zodResolver(registerStep1AccountSchema),
    defaultValues,
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
        <Field label="Nome" required error={errors.nome?.message}>
          <Input invalid={!!errors.nome} {...register('nome')} />
        </Field>
        <Field label="Cognome" required error={errors.cognome?.message}>
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
  onBack,
  onNext,
}: {
  defaultValues?: CompanyData;
  onBack: () => void;
  onNext: (data: CompanyData) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<CompanyData>({
    resolver: zodResolver(registerStep2CompanySchema),
    defaultValues,
    mode: 'onChange',
  });

  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-4">
      <Field label="Tipo azienda" required error={errors.type?.message}>
        <Select invalid={!!errors.type} {...register('type')} defaultValue="">
          <option value="" disabled>
            Seleziona...
          </option>
          <option value="DEALER">Dealer / Commerciante</option>
          <option value="AGENZIA">Agenzia pratiche auto</option>
        </Select>
      </Field>

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
// STEP 3 - DOCUMENTI (placeholder, attivato in Fase 3)
// ============================================================

function DocumentsStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="space-y-4">
      <Alert variant="warning" title="Upload documenti — disponibile in Fase 3">
        Qui chiederemo: CI fronte/retro, Codice Fiscale, Visura Camerale (max 6 mesi). Lo
        storage sicuro e la validazione IA verranno attivati nella prossima fase di
        sviluppo. Per ora puoi proseguire e completare la registrazione.
      </Alert>
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <Button type="button" variant="secondary" onClick={onBack} className="sm:w-auto">
          Indietro
        </Button>
        <Button type="button" onClick={onNext} className="sm:flex-1">
          Avanti
        </Button>
      </div>
    </div>
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
