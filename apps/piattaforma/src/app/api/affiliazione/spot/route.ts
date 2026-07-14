import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { hasPermesso } from '@/lib/auth/permessi/guard';
import { AFF_SPOT_COOKIE } from '@/lib/affiliazione/spot-cookie';
import { getAffiliazioneSpot, dismissAffiliazioneSpot } from '@/lib/affiliazione/spot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cookie di sessione (no maxAge ⇒ muore col browser), leggibile dal client. */
function segnaVista(res: NextResponse): NextResponse {
  res.cookies.set(AFF_SPOT_COOKIE, '1', {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}

/**
 * GET /api/affiliazione/spot — dice al client se mostrare la modale di lancio
 * dell'affiliazione, e con quali dati.
 *
 * Setta il cookie SEMPRE, anche quando risponde `show: false`: senza, un utente
 * che non deve vedere la modale (permesso mancante, già dismessa) rifarebbe
 * questa fetch a ogni cambio pagina, perché la chrome rimonta ogni volta.
 */
export async function GET(): Promise<Response> {
  // Il payload contiene il link referral dell'azienda: è dato aziendale, e il
  // gate è `affiliazione.view`. `getAffiliazioneSpot()` lo ricontrolla da sé
  // (è l'unità testata, e deve restare fail-closed anche se riusata altrove),
  // ma il permesso va CITATO qui: mappa-api.ts pretende che ogni route con un
  // permesso lo dichiari nel proprio sorgente, così una route nuova non resta
  // scoperta in silenzio.
  if (!(await hasPermesso('affiliazione.view'))) {
    return segnaVista(NextResponse.json({ show: false }));
  }

  const spot = await getAffiliazioneSpot();
  if (!spot) return segnaVista(NextResponse.json({ show: false }));
  return segnaVista(NextResponse.json({ show: true, ...spot }));
}

/**
 * POST /api/affiliazione/spot — "non mostrare più": presa visione definitiva.
 * Persiste su `User.affiliazioneSpotDismissedAt` (cross-device, sopravvive al
 * logout e alla pulizia dei cookie).
 */
export async function POST(): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  await dismissAffiliazioneSpot(userId);
  return segnaVista(NextResponse.json({ ok: true }));
}
