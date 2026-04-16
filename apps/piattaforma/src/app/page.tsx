import Link from 'next/link';
import { Button, Card } from '@/components/ui';
import { SiteHeader } from '@/components/site-header';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <SiteHeader />

      <section className="bg-pv-slate-50">
        <div className="mx-auto max-w-6xl px-5 pb-14 pt-12 sm:px-6 sm:pt-20 sm:pb-20">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-pv-navy-600/20 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-pv-navy-700">
              <span className="h-1.5 w-1.5 rounded-full bg-pv-orange-500" />
              Broker digitale automotive
            </span>
            <h1 className="mt-5 text-[34px] font-extrabold leading-tight tracking-tight text-pv-navy-900 sm:text-[44px]">
              Passaggi di proprietà veicoli,{' '}
              <span className="text-pv-navy-700">veloci e sicuri</span>.
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-pv-slate-700 sm:text-base">
              Connettiamo dealer e agenzie pratiche auto in una piattaforma unica.
              Gestisci pratiche, documenti e pagamenti senza carta, in conformità ACI.
            </p>

            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row">
              <Link href="/register">
                <Button size="md" className="w-full sm:w-auto">
                  Registra la tua azienda
                </Button>
              </Link>
              <Link href="/login">
                <Button size="md" variant="secondary" className="w-full sm:w-auto">
                  Accedi
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-6 sm:py-16">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TrustCard
            title="Sicuro"
            text="Mandato SEPA, KYC e documenti criptati end-to-end."
            icon={<ShieldIcon />}
          />
          <TrustCard
            title="Veloce"
            text="Pratica completa in 48 ore, con notifiche in tempo reale."
            icon={<BoltIcon />}
          />
          <TrustCard
            title="Assistito"
            text="Team dedicato e supporto tecnico in ogni fase del passaggio."
            icon={<SupportIcon />}
          />
        </div>
      </section>

      <footer className="mt-auto bg-pv-navy-900 text-pv-slate-300">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-3 px-5 py-6 text-[13px] sm:flex-row sm:items-center sm:px-6">
          <p>© {new Date().getFullYear()} Passaggio Veloce · Tutti i diritti riservati</p>
          <p className="text-pv-slate-500">
            Broker digitale per passaggi di proprietà veicoli
          </p>
        </div>
      </footer>
    </main>
  );
}

function TrustCard({
  title,
  text,
  icon,
}: {
  title: string;
  text: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-col items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-pv-navy-100 text-pv-navy-700">
          {icon}
        </div>
        <div>
          <h3 className="text-[15px] font-bold text-pv-navy-800">{title}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-pv-slate-500">{text}</p>
        </div>
      </div>
    </Card>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M12 3l8 3v5c0 4.5-3.2 8.6-8 10-4.8-1.4-8-5.5-8-10V6l8-3z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M9 12l2 2 4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M13 3L4 14h7l-1 7 9-11h-7l1-7z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SupportIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path
        d="M4 12a8 8 0 0116 0v4a3 3 0 01-3 3h-1v-7h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 12v4a3 3 0 003 3h1v-7H4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
