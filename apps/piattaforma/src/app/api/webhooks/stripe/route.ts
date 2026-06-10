import { env } from '@/env';
import { getStripe } from '@/lib/providers/payment/stripe-client';
import { handleStripeEvent } from '@/lib/jobs/stripe-webhook';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const sig = req.headers.get('stripe-signature');
  if (!sig || !env.STRIPE_WEBHOOK_SECRET) {
    return new Response('Webhook non configurato', { status: 400 });
  }
  // Raw body obbligatorio per la verifica firma: niente parse JSON.
  const body = await req.text();
  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return new Response(`Firma non valida: ${(e as Error).message}`, { status: 400 });
  }
  try {
    await handleStripeEvent(event);
  } catch (e) {
    console.error('[stripe-webhook] handler error', (e as Error).message);
    return new Response('Errore handler', { status: 500 });
  }
  return new Response('ok', { status: 200 });
}
