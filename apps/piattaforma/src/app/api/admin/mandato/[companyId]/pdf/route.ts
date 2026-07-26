import { NextResponse } from 'next/server';
import { prisma } from '@pv/db';
import { auth } from '@/auth';
import { isAdminOrAssistente } from '@/lib/auth/permissions';
import { storageGetBuffer } from '@/lib/providers/storage';
import { romeIsoDate } from '@/lib/date/rome-day';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Parte filename ASCII-safe: ogni sequenza non alfanumerica (spazi, punti,
 * accenti, ecc.) diventa "_". Usata per il nome "parlante" del mandato.
 */
function slug(s: string): string {
  return (
    s
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80) || 'azienda'
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ companyId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user || !isAdminOrAssistente(session.user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const { companyId } = await params;

  const [mandato, company] = await Promise.all([
    prisma.mandatoFatturazione.findUnique({
      where: { companyId },
      select: { storageKey: true, firmatoAt: true },
    }),
    prisma.company.findUnique({
      where: { id: companyId },
      select: { ragioneSociale: true },
    }),
  ]);
  if (!mandato) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Nome file "parlante": <RagioneSociale>_mandato_firmato_<YYYY-MM-DD>.pdf
  const data = mandato.firmatoAt ? romeIsoDate(mandato.firmatoAt) : 'na';
  const filename = `${slug(company?.ragioneSociale ?? companyId)}_mandato_firmato_${data}.pdf`;

  const buffer = await storageGetBuffer(mandato.storageKey);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      // "attachment" → download diretto col nome parlante (il link admin è "Scarica PDF").
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
