'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import {
  registerStep1AccountSchema,
  registerStep2CompanySchema,
  registerStep4PaymentSchema,
} from '@/lib/auth/schemas';
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
  { id: 1, label: 'Account' },
  { id: 2, label: 'Azienda' },
  { id: 3, label: 'Documenti' },
  { id: 4, label: 'Pagamento' },
] as const;

export function RegisterWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
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
        setSuccess(
          `Registrazione completata! In dev, token verifica: ${result.emailVerificationToken}`,
        );
        setTimeout(() => router.push('/login'), 2500);
      } else {
        setSubmitError(result.error);
      }
    });
  };

  return (
    <div className="space-y-6">
      <Stepper current={step} />

      {success && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">{success}</div>
      )}
      {submitError && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{submitError}</div>
      )}

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
  );
}

// ============================================================
// STEPPER
// ============================================================

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center justify-between text-xs">
      {STEPS.map((s) => {
        const isDone = current > s.id;
        const isCurrent = current === s.id;
        return (
          <li key={s.id} className="flex flex-1 items-center">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                isDone
                  ? 'bg-green-600 text-white'
                  : isCurrent
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-200 text-slate-600'
              }`}
            >
              {s.id}
            </div>
            <span
              className={`ml-2 ${isCurrent ? 'font-semibold text-slate-900' : 'text-slate-500'}`}
            >
              {s.label}
            </span>
            {s.id < STEPS.length && <div className="mx-2 h-px flex-1 bg-slate-200" />}
          </li>
        );
      })}
    </ol>
  );
}

// ============================================================
// FIELD WRAPPER
// ============================================================

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

const inputClass =
  'block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

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
    formState: { errors },
  } = useForm<AccountData>({
    resolver: zodResolver(registerStep1AccountSchema),
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-4">
      <Field label="Email" error={errors.email?.message}>
        <input type="email" autoComplete="email" {...register('email')} className={inputClass} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Password" error={errors.password?.message}>
          <input
            type="password"
            autoComplete="new-password"
            {...register('password')}
            className={inputClass}
          />
        </Field>
        <Field label="Conferma password" error={errors.passwordConfirm?.message}>
          <input
            type="password"
            autoComplete="new-password"
            {...register('passwordConfirm')}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Nome" error={errors.nome?.message}>
          <input {...register('nome')} className={inputClass} />
        </Field>
        <Field label="Cognome" error={errors.cognome?.message}>
          <input {...register('cognome')} className={inputClass} />
        </Field>
      </div>

      <Field label="Codice Fiscale" error={errors.codiceFiscale?.message}>
        <input {...register('codiceFiscale')} className={inputClass} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Data di nascita" error={errors.dataNascita?.message}>
          <input type="date" {...register('dataNascita')} className={inputClass} />
        </Field>
        <Field label="Luogo di nascita" error={errors.luogoNascita?.message}>
          <input {...register('luogoNascita')} className={inputClass} />
        </Field>
      </div>

      <button
        type="submit"
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
      >
        Avanti
      </button>
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
    formState: { errors },
  } = useForm<CompanyData>({
    resolver: zodResolver(registerStep2CompanySchema),
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onNext)} className="space-y-4">
      <Field label="Tipo azienda" error={errors.type?.message}>
        <select {...register('type')} className={inputClass} defaultValue="">
          <option value="" disabled>
            Seleziona...
          </option>
          <option value="DEALER">Dealer / Commerciante</option>
          <option value="AGENZIA">Agenzia pratiche auto</option>
        </select>
      </Field>

      <Field label="Ragione sociale" error={errors.ragioneSociale?.message}>
        <input {...register('ragioneSociale')} className={inputClass} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="P.IVA" error={errors.partitaIva?.message}>
          <input {...register('partitaIva')} className={inputClass} />
        </Field>
        <Field label="Codice SDI (opzionale)" error={errors.codiceSdi?.message}>
          <input {...register('codiceSdi')} className={inputClass} />
        </Field>
      </div>

      <Field label="PEC" error={errors.pec?.message}>
        <input type="email" {...register('pec')} className={inputClass} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Email aziendale" error={errors.email?.message}>
          <input type="email" {...register('email')} className={inputClass} />
        </Field>
        <Field label="Telefono (opzionale)" error={errors.telefono?.message}>
          <input {...register('telefono')} className={inputClass} />
        </Field>
      </div>

      <Field label="Indirizzo" error={errors.indirizzo?.message}>
        <input {...register('indirizzo')} className={inputClass} />
      </Field>

      <div className="grid grid-cols-3 gap-4">
        <Field label="Città" error={errors.citta?.message}>
          <input {...register('citta')} className={inputClass} />
        </Field>
        <Field label="CAP" error={errors.cap?.message}>
          <input {...register('cap')} className={inputClass} />
        </Field>
        <Field label="Prov." error={errors.provincia?.message}>
          <input maxLength={2} {...register('provincia')} className={inputClass} />
        </Field>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          Indietro
        </button>
        <button
          type="submit"
          className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          Avanti
        </button>
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
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Upload documenti — disponibile in Fase 3</p>
        <p className="mt-1">
          Qui chiederemo: CI fronte/retro, Codice Fiscale, Visura Camerale (max 6 mesi).
          Lo storage sicuro e la validazione IA verranno attivati nella prossima fase di
          sviluppo. Per ora puoi proseguire e completare la registrazione.
        </p>
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          Indietro
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          Avanti
        </button>
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
    formState: { errors },
  } = useForm<PaymentData>({
    resolver: zodResolver(registerStep4PaymentSchema),
    defaultValues,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Field label="IBAN" error={errors.iban?.message}>
        <input
          {...register('iban')}
          placeholder="IT60X0542811101000000123456"
          className={inputClass}
        />
      </Field>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        Il mandato SEPA reale verrà attivato in Fase 5 tramite Stripe. Per ora salviamo
        solo l&apos;accettazione.
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" {...register('sepaMandateAccepted')} className="mt-0.5" />
        <span>
          Autorizzo l&apos;addebito automatico SEPA per i pagamenti delle pratiche e per
          gli auto-addebiti previsti dai Termini.
        </span>
      </label>
      {errors.sepaMandateAccepted && (
        <p className="text-xs text-red-600">{errors.sepaMandateAccepted.message}</p>
      )}

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" {...register('termsAccepted')} className="mt-0.5" />
        <span>
          Ho letto e accetto i Termini e Condizioni e l&apos;Informativa Privacy di
          Passaggio Veloce.
        </span>
      </label>
      {errors.termsAccepted && (
        <p className="text-xs text-red-600">{errors.termsAccepted.message}</p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          Indietro
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? 'Registrazione...' : 'Completa registrazione'}
        </button>
      </div>
    </form>
  );
}
