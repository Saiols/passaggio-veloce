import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import {
  parseGiustificativoFiltriFromUrl,
  giustificativoWhere,
} from '@/lib/fatturazione/giustificativo-filtri';
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

  const filtri = parseGiustificativoFiltriFromUrl(new URL(req.url));
  const docs = await prisma.giustificativoInterno.findMany({
    where: giustificativoWhere(filtri),
    orderBy: { emessoAt: 'desc' },
  });

  const header = ['Data', 'Numero', 'Beneficiario', 'Importo', 'Codici promo'];
  const rows = docs.map((d) => {
    const b = d.datiBeneficiario as unknown as DatiFiscali;
    const righe = (d.righe as unknown as { code: string }[]) ?? [];
    return [
      d.emessoAt.toISOString().slice(0, 10),
      d.numeroStr,
      b?.ragioneSociale ?? '',
      (d.importoCent / 100).toFixed(2),
      righe.map((r) => r.code).join(' '),
    ]
      .map(csvCell)
      .join(';');
  });
  const csv = [header.map(csvCell).join(';'), ...rows].join('\n');

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="costi-promozionali.csv"',
      'Cache-Control': 'private, no-store',
    },
  });
}
