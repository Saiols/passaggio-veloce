import { env } from '@/env';
import { verificaFirmaResend } from '@/lib/webhooks/resend-signature';
import { handleResendEvent } from '@/lib/jobs/resend-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  if (!env.RESEND_WEBHOOK_SECRET) {
    console.error('[resend-webhook] RESEND_WEBHOOK_SECRET non configurato: evento scartato');
    return new Response('Webhook non configurato', { status: 400 });
  }

  // Raw body obbligatorio: la firma è calcolata sui byte esatti.
  const body = await req.text();
  const headers = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  };

  const evento = verificaFirmaResend(body, headers, env.RESEND_WEBHOOK_SECRET);
  if (!evento) return new Response('Firma non valida', { status: 401 });

  try {
    await handleResendEvent(evento);
  } catch (e) {
    // I casi "non trovato" escono con `return` e non lanciano: qui arrivano
    // solo errori Prisma o di infrastruttura, cioè proprio quelli per cui i
    // retry di Svix esistono. Un 200 li perderebbe per sempre.
    console.error('[resend-webhook] handler error', (e as Error).message);
    return new Response('Errore handler', { status: 500 });
  }
  return new Response('ok', { status: 200 });
}
