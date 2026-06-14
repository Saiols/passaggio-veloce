import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma, type Prisma, type DocumentoFiscaleTipo } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { numeroDocumento, labelTipoDocumento } from '@/lib/fatturazione/format';
import type { DatiFiscali } from '@/lib/fatturazione/pv-emittente';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIPI = ['FATTURA_PV', 'DOC_BROKER', 'NOTA_VARIAZIONE', 'PENALE_BROKER'] as const;

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
  const q = (url.searchParams.get('q') ?? '').trim();
  const numQ = /^\d+$/.test(q) ? Number(q) : null;
  const tipo = url.searchParams.get('tipo') ?? '';
  const tipoFilter = (TIPI as readonly string[]).includes(tipo)
    ? (tipo as DocumentoFiscaleTipo)
    : null;

  const where: Prisma.DocumentoFiscaleWhereInput = {
    ...(tipoFilter ? { tipo: tipoFilter } : {}),
    ...(q
      ? {
          OR: [
            { pratica: { codicePratica: { contains: q, mode: 'insensitive' } } },
            ...(numQ !== null ? [{ numeroProgressivo: numQ }] : []),
          ],
        }
      : {}),
  };

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
      numeroDocumento(d),
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
