import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma, Prisma } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';

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

function startDate(p: string | null): Date | null {
  const d = new Date();
  if (p === '7d') {
    d.setDate(d.getDate() - 7);
    return d;
  }
  if (p === '30d') {
    d.setDate(d.getDate() - 30);
    return d;
  }
  if (p === '12m') {
    d.setMonth(d.getMonth() - 12);
    return d;
  }
  return null;
}

/**
 * Export CSV completo della tabella commissioni filtrata (item 19 release
 * 2026-05). Riservato a ADMIN_PIATTAFORMA per evitare leak dati finanziari
 * aggregati a ASSISTENTE (D-02).
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isAdminPiattaforma(session.user.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const periodo = url.searchParams.get('periodo');
  const agenzia = url.searchParams.get('agenzia');
  const pratica = url.searchParams.get('pratica');
  const minImporto = url.searchParams.get('minImporto');
  const maxImporto = url.searchParams.get('maxImporto');

  const since = startDate(periodo);
  const where: Prisma.CommissioneAffiliazioneWhereInput = {};
  if (since) where.createdAt = { gte: since };
  if (agenzia) where.referenteId = agenzia;
  if (pratica) where.praticaId = pratica;
  if (minImporto && Number.isFinite(Number(minImporto))) {
    where.importoNettoCent = {
      ...(where.importoNettoCent as object),
      gte: Math.round(Number(minImporto) * 100),
    };
  }
  if (maxImporto && Number.isFinite(Number(maxImporto))) {
    where.importoNettoCent = {
      ...(where.importoNettoCent as object),
      lte: Math.round(Number(maxImporto) * 100),
    };
  }

  const rows = await prisma.commissioneAffiliazione.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      pratica: {
        select: {
          codicePratica: true,
          targa: true,
          tipo: true,
          stato: true,
          broker: { select: { ragioneSociale: true } },
          agenziaAssegnata: { select: { ragioneSociale: true } },
        },
      },
      referente: {
        select: { ragioneSociale: true, type: true },
      },
    },
  });

  const header = [
    'Data',
    'CommissioneId',
    'PraticaCodice',
    'Targa',
    'TipoPratica',
    'StatoPratica',
    'Broker',
    'Agenzia',
    'Referente',
    'TipoReferente',
    'TipoCommissione',
    'StatoCommissione',
    'ImportoNettoEur',
  ];

  const lines = rows.map((c) =>
    [
      c.createdAt.toISOString(),
      c.id,
      c.pratica.codicePratica ?? '',
      c.pratica.targa ?? '',
      c.pratica.tipo,
      c.pratica.stato,
      c.pratica.broker.ragioneSociale,
      c.pratica.agenziaAssegnata?.ragioneSociale ?? '',
      c.referente.ragioneSociale,
      c.referente.type === 'DEALER' ? 'Broker' : 'Agenzia',
      c.tipo,
      c.stato,
      (c.importoNettoCent / 100).toFixed(2),
    ]
      .map(csvEscape)
      .join(','),
  );

  const csv = [header.join(','), ...lines].join('\n');
  const filename = `pv-affiliazioni-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
