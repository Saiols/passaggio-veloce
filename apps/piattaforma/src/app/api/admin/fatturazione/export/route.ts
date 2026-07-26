import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma, type Prisma } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { labelTipoDocumento } from '@/lib/fatturazione/format';
import { parseFatturaFiltriFromUrl, fatturaWhereFiltri } from '@/lib/fatturazione/filtri';
import type { DatiFiscali } from '@/lib/fatturazione/pv-emittente';
import { csvCell } from '@/lib/csv';
import { romeIsoDate } from '@/lib/date/rome-day';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user || !isAdminPiattaforma(session.user.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  // Legge TUTTE le chiavi note (compresa `emissione`) dall'URL, invece di
  // elencarle a mano: vedi il commento su `parseFatturaFiltriFromUrl` — un
  // filtro dimenticato qui veniva scartato in silenzio (C-1).
  const filtri = parseFatturaFiltriFromUrl(url);
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
      // Stessa data che PDF e XML stampano su questo documento: quelli sono
      // già in calendario di Roma, e un documento emesso fra le 23:00 e le
      // 24:00 UTC qui comparirebbe datato al giorno prima della sua fattura.
      romeIsoDate(d.emessoAt),
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
