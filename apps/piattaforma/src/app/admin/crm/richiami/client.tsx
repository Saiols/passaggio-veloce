import Link from 'next/link';
import { etichettaRichiamo, type FasciaRichiamo } from '@/lib/crm/richiamo';
import { googleCalendarUrl } from '@/lib/crm/google-calendar';
import { telHref } from '@/lib/crm/tel';

type Riga = {
  id: string;
  nome: string;
  cat: 'BROKER' | 'AGENZIA';
  tel: string;
  citta: string | null;
  nextContactAt: string;
  nextContactFascia: string | null;
};

function Card({ r, coloreTesto }: { r: Riga; coloreTesto: string }) {
  const et = etichettaRichiamo(r.nextContactAt, r.nextContactFascia, new Date());
  const href = telHref(r.tel);
  const gcal = googleCalendarUrl({
    nome: r.nome,
    tel: r.tel,
    citta: r.citta,
    giorno: new Date(r.nextContactAt),
    fascia: (r.nextContactFascia as FasciaRichiamo | null) ?? null,
  });
  return (
    <li className="flex flex-col gap-2 rounded-[12px] border border-pv-slate-200 bg-white px-4 py-3 shadow-[var(--pv-shadow-card)] sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className={'text-[12px] font-bold ' + coloreTesto}>📞 {et.testo}</p>
        <p className="mt-0.5 truncate text-[14px] font-semibold text-pv-navy-900">
          {r.nome}{' '}
          <span className="text-[12px] font-medium text-pv-slate-500">
            · {r.cat === 'BROKER' ? 'Broker' : 'Agenzia'}
            {r.citta ? ` · ${r.citta}` : ''}
          </span>
        </p>
        {href ? (
          <a href={href} className="text-[13px] font-semibold text-pv-navy-700 hover:underline">
            {r.tel}
          </a>
        ) : (
          <span className="text-[13px] text-pv-slate-500">{r.tel}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={`/admin/crm/contatti?q=${encodeURIComponent(r.tel)}`}
          className="rounded-[8px] border-[1.5px] border-pv-slate-300 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
        >
          Apri contatto
        </Link>
        <a
          href={gcal}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-[8px] bg-pv-navy-700 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-pv-navy-800"
        >
          Aggiungi a Google Calendar
        </a>
      </div>
    </li>
  );
}

function Sezione({
  titolo,
  righe,
  coloreTesto,
}: {
  titolo: string;
  righe: Riga[];
  coloreTesto: string;
}) {
  if (righe.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wider text-pv-slate-500">
        {titolo} · {righe.length}
      </h2>
      <ul className="space-y-2">
        {righe.map((r) => (
          <Card key={r.id} r={r} coloreTesto={coloreTesto} />
        ))}
      </ul>
    </section>
  );
}

export function RichiamiClient({ righe }: { righe: Riga[] }) {
  const now = new Date();
  const scaduti: Riga[] = [];
  const oggi: Riga[] = [];
  const prossimi: Riga[] = [];
  for (const r of righe) {
    const et = etichettaRichiamo(r.nextContactAt, r.nextContactFascia, now);
    if (et.scaduto) scaduti.push(r);
    else if (et.oggi) oggi.push(r);
    else prossimi.push(r);
  }

  if (righe.length === 0) {
    return (
      <div className="rounded-[16px] border border-pv-slate-200 bg-white px-5 py-12 text-center text-[13px] text-pv-slate-500 shadow-[var(--pv-shadow-card)]">
        Nessun richiamo programmato. Impostane uno dalla lista contatti.
      </div>
    );
  }

  return (
    <>
      <Sezione titolo="Scaduti" righe={scaduti} coloreTesto="text-pv-red-500" />
      <Sezione titolo="Oggi" righe={oggi} coloreTesto="text-pv-orange-500" />
      <Sezione titolo="Prossimi" righe={prossimi} coloreTesto="text-pv-slate-500" />
    </>
  );
}
