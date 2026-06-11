import 'server-only';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { auth } from '@/auth';
import { uploadRequiresAuth } from '@/lib/blob/upload-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Endpoint per i client upload di Vercel Blob (`@vercel/blob/client` `upload()`).
 * Il browser carica il file DIRETTAMENTE su Blob, bypassando il limite 4,5 MB
 * sul body delle funzioni serverless. Qui generiamo solo il token firmato,
 * vincolato a utente autenticato + MIME/dimensione consentiti.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // I documenti KYC di registrazione si caricano PRIMA che l'account
        // esista (nessuna sessione): quello scope è esente da auth. Tutto il
        // resto (es. allegati pratica) richiede una sessione valida.
        if (uploadRequiresAuth(pathname)) {
          const session = await auth();
          if (!session?.user) {
            throw new Error('Non autenticato');
          }
        }
        return {
          allowedContentTypes: ACCEPTED_MIME,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: false,
        };
      },
      // Webhook post-upload: non ci affidiamo a questo (la chiave viene
      // registrata al submit/verify). No-op. In locale non viene nemmeno
      // invocato (serve un URL pubblico).
      onUploadCompleted: async () => {},
    });
    return Response.json(json);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
