import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { canViewAggregatedFinancials } from '@/lib/auth/permissions';
import { filtriPratiche } from '@/lib/finanze/periodo';
import { romeIsoDate } from '@/lib/date/rome-day';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!canViewAggregatedFinancials(session.user.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const { periodo, tipo, range, where } = filtriPratiche({
    periodo: url.searchParams.get('periodo'),
    tipo: url.searchParams.get('tipo'),
    da: url.searchParams.get('da'),
    a: url.searchParams.get('a'),
  });

  const pratiche = await prisma.pratica.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      broker: { select: { ragioneSociale: true } },
      agenziaAssegnata: { select: { ragioneSociale: true } },
    },
  });

  const headers = [
    'codicePratica',
    'tipo',
    'numeroVeicoli',
    'stato',
    'broker',
    'agenzia',
    'comune',
    'provincia',
    'feeAgenziaEur',
    'creditoBrokerEur',
    'nostroLordoEur',
    // Round di distribuzione in cui la pratica è stata accettata (vuoto per le
    // pratiche mai accettate o assegnate a mano dall'admin).
    'roundAccettazione',
    'createdAt',
    'firmaAvvenutaAt',
  ];
  const rows = pratiche.map((p) => [
    p.codicePratica ?? '',
    p.tipo,
    p.numeroVeicoli,
    p.stato,
    p.broker.ragioneSociale,
    p.agenziaAssegnata?.ragioneSociale ?? '',
    p.comune ?? '',
    p.provincia ?? '',
    (p.feeAgenziaCent / 100).toFixed(2),
    (p.creditoBrokerCent / 100).toFixed(2),
    ((p.feeAgenziaCent - p.creditoBrokerCent) / 100).toFixed(2),
    p.roundAccettazione ?? '',
    p.createdAt.toISOString(),
    p.firmaAvvenutaAt?.toISOString() ?? '',
  ]);

  const csv = [
    headers.join(','),
    ...rows.map((r) => r.map(csvEscape).join(',')),
  ].join('\n');

  // Su `custom` la parola "custom" non direbbe nulla una volta salvato sul
  // disco: nel nome ci vanno le due date.
  const periodoSlug =
    periodo === 'custom' ? `${range.da || 'inizio'}_${range.a || 'oggi'}` : periodo;
  const filename = `pratiche-${periodoSlug}${tipo ? `-${tipo.toLowerCase()}` : ''}-${romeIsoDate(new Date())}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
