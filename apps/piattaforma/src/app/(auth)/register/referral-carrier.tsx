'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/**
 * Landing card grid (item 5 release 2026-05): client component perché legge
 * ?ref= via useSearchParams e lo passa nei link delle due card. Tutto il
 * markup di scelta dealer/agenzia vive qui per evitare il pattern
 * render-prop attraverso il boundary RSC→Client (non serializzabile).
 */
export function RegisterChoiceCards() {
  const sp = useSearchParams();
  const ref = sp.get('ref');
  const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : '';

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <ChoiceCard
        href={`/register/dealer${refQuery}`}
        accent="navy"
        eyebrow="Sono un dealer"
        title="Dealer auto / Commerciante"
        description="Carichi pratiche di passaggio per i tuoi clienti. La piattaforma le smista alle agenzie disponibili nella tua zona, tu segui solo il flusso e ricevi il credito a firma avvenuta."
        bullets={[
          'Caricamento rapido pratiche con OCR libretto',
          'Distribuzione automatica alle agenzie locali',
          'Wallet con accredito automatico al passaggio firmato',
        ]}
      />
      <ChoiceCard
        href={`/register/agenzia${refQuery}`}
        accent="orange"
        eyebrow="Sono un'agenzia"
        title="Agenzia pratiche auto"
        description="Ricevi pratiche dal bacino dealer e gestisci le minivolture, i passaggi privati e le procure. Definisci tu orari e zone di copertura, accetti solo ciò che ti interessa."
        bullets={[
          'Inbox pratiche da approvare con countdown ore lavorative',
          'Orari e ferie configurabili per evitare assegnazioni fuori turno',
          'Ranking valutazioni che premia la qualità del lavoro',
        ]}
      />
    </div>
  );
}

function ChoiceCard({
  href,
  accent,
  eyebrow,
  title,
  description,
  bullets,
}: {
  href: string;
  accent: 'navy' | 'orange';
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
}) {
  const accentRing =
    accent === 'navy'
      ? 'hover:border-pv-navy-600 hover:shadow-[0_0_0_4px_rgb(0_84_166_/_0.10)]'
      : 'hover:border-pv-orange-500 hover:shadow-[0_0_0_4px_rgb(255_122_0_/_0.10)]';
  const accentChip =
    accent === 'navy'
      ? 'bg-pv-navy-100 text-pv-navy-700'
      : 'bg-pv-orange-500/10 text-pv-orange-500';
  const accentArrow =
    accent === 'navy' ? 'text-pv-navy-700' : 'text-pv-orange-500';
  return (
    <Link
      href={href}
      className={`group block rounded-[20px] border-2 border-pv-slate-200 bg-white p-6 transition-all ${accentRing}`}
    >
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${accentChip}`}
      >
        {eyebrow}
      </span>
      <h2 className="mt-3 text-[20px] font-extrabold text-pv-navy-900 sm:text-[22px]">
        {title}
      </h2>
      <p className="mt-2 text-[13px] leading-relaxed text-pv-slate-700">
        {description}
      </p>
      <ul className="mt-4 space-y-1.5 text-[12.5px] text-pv-slate-700">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-pv-slate-300" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <span
        className={`mt-5 inline-flex items-center gap-1 text-[13px] font-bold ${accentArrow}`}
      >
        Inizia →
      </span>
    </Link>
  );
}
