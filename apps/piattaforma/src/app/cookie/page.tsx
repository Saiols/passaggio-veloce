import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';

export const metadata = {
  title: 'Cookie Policy — Passaggio Veloce',
};

export default function CookiePage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <article className="mx-auto w-full max-w-3xl px-5 py-10 text-[14px] leading-relaxed text-pv-slate-700 sm:px-6">
        <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
          Cookie Policy
        </h1>
        <p className="mt-2 text-[12px] text-pv-slate-500">
          Ultimo aggiornamento: 2026-05-06
        </p>

        <Section title="Cosa sono i cookie">
          <p>
            I cookie sono piccoli file di testo memorizzati dal tuo browser
            quando visiti un sito web. Possono essere usati per ricordare le
            tue preferenze, mantenere la sessione di login o raccogliere
            statistiche aggregate.
          </p>
        </Section>

        <Section title="Cookie utilizzati">
          <h3 className="mt-2 text-[15px] font-bold text-pv-navy-900">
            Tecnici (sempre attivi)
          </h3>
          <ul className="list-disc pl-5">
            <li>
              <code>authjs.session-token</code> — sessione di login
              (HTTP-only, secure)
            </li>
            <li>
              <code>authjs.csrf-token</code> — protezione CSRF
            </li>
            <li>
              <code>pv-cookie-consent-v1</code> — memorizza la tua scelta sui
              cookie (LocalStorage)
            </li>
          </ul>
          <p>
            Senza questi cookie la piattaforma non può funzionare: sono
            esclusi dall&apos;obbligo di consenso preventivo (art. 122 codice
            privacy).
          </p>

          <h3 className="mt-4 text-[15px] font-bold text-pv-navy-900">
            Analytics
          </h3>
          <p>
            <strong>Nessuno attualmente attivo.</strong> Quando attiveremo
            analytics aggregato (privacy-friendly, server-side) chiederemo
            consenso esplicito.
          </p>

          <h3 className="mt-4 text-[15px] font-bold text-pv-navy-900">
            Marketing / Tracking referral
          </h3>
          <p>
            Il programma affiliazione tracking utilizza un cookie di prima
            parte di durata 30 giorni per attribuire gli utenti che si
            registrano dopo aver cliccato un link <code>/r/&lt;code&gt;</code>.
            Il dato salvato è solo l&apos;identificativo del referente.
          </p>
        </Section>

        <Section title="Come gestire i cookie">
          <p>
            Puoi modificare le tue preferenze cookie in qualsiasi momento dal
            banner che appare al primo accesso o cancellando il LocalStorage
            del browser. Le scelte di terze parti possono essere gestite
            anche dalle impostazioni del browser.
          </p>
        </Section>

        <p className="mt-8 text-[11px] text-pv-slate-500">
          Vedi anche la{' '}
          <Link href="/privacy" className="font-semibold text-pv-navy-700 hover:underline">
            Privacy Policy
          </Link>{' '}
          completa.
        </p>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[18px] font-bold text-pv-navy-900">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}
