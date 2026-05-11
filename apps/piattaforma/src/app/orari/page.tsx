import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert, Button, Card } from '@/components/ui';
import { updateOrariAction } from './actions';

const GIORNI = [
  { key: 'LUN', label: 'Lunedì' },
  { key: 'MAR', label: 'Martedì' },
  { key: 'MER', label: 'Mercoledì' },
  { key: 'GIO', label: 'Giovedì' },
  { key: 'VEN', label: 'Venerdì' },
  { key: 'SAB', label: 'Sabato' },
  { key: 'DOM', label: 'Domenica' },
] as const;

type Fascia = { inizio: string; fine: string };

function parseFasce(raw: unknown): Fascia[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f): f is Fascia =>
      typeof f === 'object' &&
      f !== null &&
      typeof (f as Fascia).inizio === 'string' &&
      typeof (f as Fascia).fine === 'string',
  );
}

export default async function OrariPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  if (session.user.companyType !== 'AGENZIA') {
    return (
      <AppShell session={session} activePath="/orari">
        <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6">
          <p className="text-pv-slate-500">
            Gli orari sono disponibili solo per le agenzie.
          </p>
        </div>
      </AppShell>
    );
  }

  const sp = await searchParams;
  const agenziaId = session.user.companyId!;
  const orari = await prisma.orariApertura.findMany({ where: { agenziaId } });
  const byGiorno = new Map<string, Fascia[]>();
  for (const o of orari) byGiorno.set(o.giorno, parseFasce(o.fasceOrarie));

  return (
    <AppShell session={session} activePath="/orari">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Profilo agenzia
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            Orari di apertura
          </h1>
          <p className="mt-1 text-[14px] text-pv-slate-500">
            Il countdown per accettare le pratiche scorre solo durante queste fasce. Puoi
            inserire fino a 2 fasce al giorno (es. mattina e pomeriggio). Lascia vuoto se
            chiuso.
          </p>
        </header>

        {sp.saved && (
          <div className="mb-5">
            <Alert variant="success">Orari aggiornati con successo.</Alert>
          </div>
        )}
        {sp.error && (
          <div className="mb-5">
            <Alert variant="error">{sp.error}</Alert>
          </div>
        )}

        <form action={handleSubmit}>
          <div className="space-y-3">
            {GIORNI.map(({ key, label }) => {
              const fasce = byGiorno.get(key) ?? [];
              const f1 = fasce[0];
              const f2 = fasce[1];
              return (
                <Card key={key} className="!p-4">
                  <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[110px_1fr_1fr]">
                    <p className="text-[14px] font-bold text-pv-navy-800">{label}</p>
                    <FasciaInputs giorno={key} slot={1} value={f1} labelPrefix="Mattina" />
                    <FasciaInputs giorno={key} slot={2} value={f2} labelPrefix="Pomeriggio" />
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="mt-6 flex justify-end">
            <Button type="submit" size="md">
              Salva orari
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}

async function handleSubmit(formData: FormData): Promise<void> {
  'use server';
  const result = await updateOrariAction(formData);
  const { redirect } = await import('next/navigation');
  if (!result.ok) {
    redirect(`/orari?error=${encodeURIComponent(result.error)}`);
  }
  redirect('/orari?saved=1');
}

function FasciaInputs({
  giorno,
  slot,
  value,
  labelPrefix,
}: {
  giorno: string;
  slot: 1 | 2;
  value?: Fascia;
  labelPrefix: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[80px] text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
        {labelPrefix}
      </span>
      <input
        type="time"
        name={`${giorno}_${slot}_start`}
        defaultValue={value?.inizio ?? ''}
        className="w-[100px] rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-2.5 py-1.5 text-[13px] font-medium text-pv-slate-900 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)]"
      />
      <span className="text-pv-slate-500">—</span>
      <input
        type="time"
        name={`${giorno}_${slot}_end`}
        defaultValue={value?.fine ?? ''}
        className="w-[100px] rounded-[10px] border-[1.5px] border-transparent bg-pv-navy-100 px-2.5 py-1.5 text-[13px] font-medium text-pv-slate-900 focus:border-pv-navy-600 focus:bg-white focus:outline-none focus:shadow-[var(--pv-ring-focus)]"
      />
    </div>
  );
}
