import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import { generateRendicontoPDF } from '@/lib/pdf/rendiconto';

/**
 * GET /api/wallet/rendiconto?year=YYYY&month=MM
 *
 * Genera il rendiconto PDF della company dell'utente loggato per il
 * periodo richiesto. Solo dealer/agenzie possono richiamarlo per il
 * proprio wallet (admin platform può chiamare con `companyId` query in
 * un secondo momento — non serve per ora).
 */
export async function GET(req: NextRequest): Promise<NextResponse | Response> {
  const session = await auth();
  if (!session?.user?.companyId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const yearParam = Number(url.searchParams.get('year') ?? '');
  const monthParam = Number(url.searchParams.get('month') ?? '');

  const now = new Date();
  // Default: mese precedente (più sensato per un rendiconto)
  const defaultYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const defaultMonth = now.getMonth() === 0 ? 12 : now.getMonth();

  const year = Number.isInteger(yearParam) && yearParam >= 2024 && yearParam <= 2099
    ? yearParam
    : defaultYear;
  const month = Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12
    ? monthParam
    : defaultMonth;

  const pdfBytes = await generateRendicontoPDF(session.user.companyId, {
    year,
    month,
  });

  const filename = `rendiconto-${year}-${String(month).padStart(2, '0')}.pdf`;

  return new Response(pdfBytes as BlobPart, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
