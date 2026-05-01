import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { canViewAggregatedFinancials } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Periodo = 'settimana' | 'mese' | 'anno';

function startOfPeriodo(p: Periodo): Date {
  const d = new Date();
  if (p === 'settimana') d.setDate(d.getDate() - 7);
  else if (p === 'mese') d.setMonth(d.getMonth() - 1);
  else d.setFullYear(d.getFullYear() - 1);
  return d;
}

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
  const periodo: Periodo = (url.searchParams.get('periodo') as Periodo) ?? 'mese';
  const tipo = url.searchParams.get('tipo') ?? '';
  const since = startOfPeriodo(periodo);

  const where: Prisma.PraticaWhereInput = {
    deletedAt: null,
    createdAt: { gte: since },
  };
  if (tipo === 'PASSAGGIO_PRIVATO' || tipo === 'MINIVOLTURE_MULTIPLE') {
    where.tipo = tipo;
  }

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
    p.createdAt.toISOString(),
    p.firmaAvvenutaAt?.toISOString() ?? '',
  ]);

  const csv = [
    headers.join(','),
    ...rows.map((r) => r.map(csvEscape).join(',')),
  ].join('\n');

  const filename = `pratiche-${periodo}${tipo ? `-${tipo.toLowerCase()}` : ''}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
