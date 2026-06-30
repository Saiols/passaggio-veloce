import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma, type Prisma } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { labelTipoDocumento } from '@/lib/fatturazione/format';
import { parseFatturaFiltri, fatturaWhereFiltri } from '@/lib/fatturazione/filtri';
import type { DatiFiscali } from '@/lib/fatturazione/pv-emittente';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cella CSV con quoting se contiene separatori/virgolette/newline. */
function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user || !isAdminPiattaforma(session.user.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const filtri = parseFatturaFiltri({
    q: url.searchParams.get('q') ?? undefined,
    tipo: url.searchParams.get('tipo') ?? undefined,
    dataDa: url.searchParams.get('dataDa') ?? undefined,
    dataA: url.searchParams.get('dataA') ?? undefined,
    sede: url.searchParams.get('sede') ?? undefined,
  });
  const where: Prisma.DocumentoFiscaleWhereInput = fatturaWhereFiltri(filtri);

  const docs = await prisma.documentoFiscale.findMany({
    where,
    orderBy: { emessoAt: 'desc' },
    include: { pratica: { select: { codicePratica: true } } },
  });

  const header = [
    'Data',
    'Numero',
    'Tipo',
    'Emittente',
    'Destinatario',
    'Imponibile',
    'IVA',
    'Totale',
    'CodicePratica',
  ];
  const rows = docs.map((d) => {
    const em = d.datiEmittente as unknown as DatiFiscali;
    const de = d.datiDestinatario as unknown as DatiFiscali;
    return [
      d.emessoAt.toISOString().slice(0, 10),
      d.numeroDocumentoStr ?? '',
      labelTipoDocumento(d.tipo),
      em?.ragioneSociale ?? '',
      de?.ragioneSociale ?? '',
      ((d.imponibileCent ?? 0) / 100).toFixed(2),
      ((d.ivaCent ?? 0) / 100).toFixed(2),
      (d.importoLordoCent / 100).toFixed(2),
      d.pratica?.codicePratica ?? '',
    ]
      .map(csvCell)
      .join(';');
  });
  const csv = [header.map(csvCell).join(';'), ...rows].join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="fatture.csv"',
      'Cache-Control': 'private, no-store',
    },
  });
}
