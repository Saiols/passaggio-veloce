/**
 * Endpoint redirect per il link "email di partenza" CRM.
 * GET /i/<invitoToken>
 *
 * 1. Se il token matcha un CrmContact, marca l'apertura (best-effort:
 *    linkAperto, linkAperture++, status → S5 avanza-non-declassa).
 * 2. Redirige a /register/dealer|agenzia in base a cat, con ?promo=<code>
 *    se il PromoCode inviato è ancora attivo. Il codice NON è nel token.
 * 3. Token invalido → /register neutro (comportamento tollerante come /r).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@pv/db';
import { nextStatoApertura } from '@/lib/crm/email-partenza';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const tok = token.trim().slice(0, 128);
  const origin = new URL(req.url).origin;

  let dest = '/register';
  let promo: string | null = null;

  try {
    const contact = await prisma.crmContact.findFirst({
      where: { invitoToken: tok },
      select: {
        id: true,
        cat: true,
        status: true,
        promoCodeInviato: { select: { code: true, active: true, expiresAt: true } },
      },
    });

    if (contact) {
      dest = contact.cat === 'BROKER' ? '/register/dealer' : '/register/agenzia';

      const pc = contact.promoCodeInviato;
      if (pc && pc.active && (!pc.expiresAt || pc.expiresAt.getTime() > Date.now())) {
        promo = pc.code;
      }

      // Tracking apertura best-effort.
      await prisma.crmContact.update({
        where: { id: contact.id },
        data: {
          linkAperto: true,
          linkAperture: { increment: 1 },
          status: nextStatoApertura(contact.status),
        },
      });
    }
  } catch {
    // best-effort: non blocchiamo il redirect
  }

  const url = new URL(dest, origin);
  if (promo) url.searchParams.set('promo', promo);
  return NextResponse.redirect(url, 302);
}
