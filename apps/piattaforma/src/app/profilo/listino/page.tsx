import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Card } from '@/components/ui';
import { ListinoClient } from './client';
import { getBenchmarkForAgenzia } from '@/lib/listini/observatory';

export default async function ListinoProfiloPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.companyType !== 'AGENZIA') {
    return (
      <AppShell session={session} activePath="/profilo">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info">
            Il listino è disponibile solo per le agenzie.
          </Alert>
        </div>
      </AppShell>
    );
  }
  const agenziaId = session.user.companyId!;

  const [listino, benchmark] = await Promise.all([
    prisma.listino.findFirst({
      where: { agenziaId },
      select: {
        id: true,
        formato: true,
        prezzoBaseTrapassoCent: true,
        prezzoMinivolturaCent: true,
        maggiorazioni: true,
        provincieCopertura: true,
        documentoStorageKey: true,
      },
    }),
    getBenchmarkForAgenzia(agenziaId),
  ]);

  const initialForm = listino
    ? {
        formato: listino.formato,
        prezzoBaseTrapassoEuro:
          (listino.prezzoBaseTrapassoCent ?? 0) / 100,
        prezzoMinivolturaEuro: (listino.prezzoMinivolturaCent ?? 0) / 100,
        pre2015MaggiorazionEuro: extractMaggiorazione(
          listino.maggiorazioni,
          'pre2015',
        ),
        lottoMassivoMaggiorazionEuro: extractMaggiorazione(
          listino.maggiorazioni,
          'lottoMassivo',
        ),
        provincieCopertura: listino.provincieCopertura.join(', '),
        hasUpload: !!listino.documentoStorageKey,
      }
    : null;

  return (
    <AppShell session={session} activePath="/profilo">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Profilo
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Listino prezzi
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            I tuoi prezzi alimentano l&apos;Osservatorio Prezzi Passaggio
            Veloce. Più listini sono pubblicati, più solido è il benchmark
            di mercato. I dati sono mostrati solo in forma aggregata.
          </p>
        </header>

        {benchmark && (
          <Card className="mb-6 border-pv-orange-500/40 bg-pv-orange-50/30">
            <h2 className="text-[14px] font-bold text-pv-navy-900">
              📊 Benchmark vs media zona
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
              <BenchmarkRow
                label="Trapasso netto"
                mioCent={benchmark.miei.trapasso}
                mediaCent={benchmark.media.trapasso}
                deltaCent={benchmark.delta.trapasso}
              />
              <BenchmarkRow
                label="Minivoltura"
                mioCent={benchmark.miei.minivoltura}
                mediaCent={benchmark.media.minivoltura}
                deltaCent={benchmark.delta.minivoltura}
              />
            </div>
            <p className="mt-3 text-[11.5px] text-pv-slate-500">
              Media calcolata sulle agenzie attive che dichiarano copertura
              sulla tua provincia principale.
            </p>
          </Card>
        )}

        <ListinoClient initial={initialForm} />
      </div>
    </AppShell>
  );
}

function extractMaggiorazione(value: unknown, key: string): number {
  if (!value || typeof value !== 'object') return 0;
  const v = (value as Record<string, unknown>)[key];
  if (typeof v === 'number') return v / 100;
  return 0;
}

function BenchmarkRow({
  label,
  mioCent,
  mediaCent,
  deltaCent,
}: {
  label: string;
  mioCent: number | null;
  mediaCent: number | null;
  deltaCent: number | null;
}) {
  const fmt = (c: number | null): string =>
    c === null ? '—' : `${(c / 100).toFixed(2)} €`;

  let deltaLabel = '—';
  let deltaCls = 'text-pv-slate-500';
  if (deltaCent !== null) {
    const sign = deltaCent > 0 ? '+' : '';
    deltaLabel = `${sign}${(deltaCent / 100).toFixed(2)} €`;
    if (deltaCent > 500) deltaCls = 'text-pv-orange-500';
    else if (deltaCent < -500) deltaCls = 'text-pv-green-500';
    else deltaCls = 'text-pv-slate-700';
  }

  return (
    <div className="rounded-[10px] bg-white px-3 py-2">
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-pv-slate-500">
        {label}
      </p>
      <p className="mt-1 text-[15px] font-bold text-pv-navy-900">
        {fmt(mioCent)}
      </p>
      <p className={'text-[11.5px] ' + deltaCls}>
        Media zona: {fmt(mediaCent)} ({deltaLabel})
      </p>
    </div>
  );
}
