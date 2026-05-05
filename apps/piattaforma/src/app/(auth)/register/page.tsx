import Link from 'next/link';
import { Suspense } from 'react';
import { RegisterChoiceCards } from './referral-carrier';

/**
 * Landing pubblica del flusso di registrazione (item 5 release 2026-05).
 * Due percorsi distinti: Dealer auto vs Agenzia pratiche. Click → wizard
 * pre-impostato sul tipo scelto. Conserviamo l'eventuale ?ref= per il
 * tracking affiliazione.
 */
export default function RegisterLandingPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-6 sm:py-14">
      <header className="mx-auto mb-8 max-w-2xl text-center sm:mb-10">
        <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
          Registrazione
        </p>
        <h1 className="mt-2 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[36px]">
          Da quale parte vuoi partire?
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-pv-slate-500 sm:text-[15px]">
          Scegli il percorso più adatto al tuo ruolo. Ogni profilo ha un
          processo di onboarding dedicato e viene attivato dopo la verifica
          dei tuoi documenti.
        </p>
      </header>

      <Suspense fallback={null}>
        <RegisterChoiceCards />
      </Suspense>

      <p className="mt-8 text-center text-[13px] text-pv-slate-500">
        Hai già un account?{' '}
        <Link
          href="/login"
          className="font-semibold text-pv-navy-700 hover:underline"
        >
          Accedi
        </Link>
      </p>
    </div>
  );
}
