import { NextResponse, type NextRequest } from 'next/server';
import { getSessionContext } from '@/lib/auth/session-context';
import { generateRendicontoPDF } from '@/lib/pdf/rendiconto';

/**
 * GET /api/wallet/rendiconto?year=YYYY&month=MM
 *
 * Rendiconto PDF dei movimenti del wallet della MADRE (`generateRendicontoPDF`
 * filtra `wallet: { companyId }`, e `Wallet` ha `sedeId` XOR `companyId`): è il
 * wallet dell'affiliazione, con i suoi crediti, i codici pratica e le targhe
 * delle pratiche dei referral.
 *
 * Dato della madre, non di una filiale ⇒ lo scarica il SOLO proprietario, in
 * qualunque vista (`isOwner`, mai `aggregate`) — stesso principio di
 * `canViewDocumentoFiscale` per i documenti senza sede. Senza questo gate un
 * OPERATORE di una sede qualsiasi otteneva il rendiconto della madre con un
 * click, senza nemmeno un UUID da indovinare.
 *
 * Fail-closed: niente company o non proprietario ⇒ 403; nessuna sessione ⇒ 401
 * (le due condizioni restano distinte: "non loggato" non è "loggato ma senza
 * diritti"). Gli admin piattaforma non hanno contesto sede (né company) e non
 * hanno oggi un ramo dedicato: la route non è linkata dall'area admin.
 */
export async function GET(req: NextRequest): Promise<NextResponse | Response> {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!ctx.companyId || !ctx.isOwner) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
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

  const pdfBytes = await generateRendicontoPDF(ctx.companyId, {
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
