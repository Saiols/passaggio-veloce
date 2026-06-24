import 'server-only';
import { auth } from '@/auth';
import { getStorage } from '@/lib/providers/storage';
import { uploadRequiresAuth } from '@/lib/blob/upload-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Fallback di upload per lo sviluppo LOCALE (attivo solo se il client invia qui,
 * vedi NEXT_PUBLIC_BLOB_LOCAL in lib/blob/upload-client.ts). Il file arriva
 * direttamente al server (route handler, NON Server Action → niente limite
 * 4,5 MB) e viene salvato dal provider di storage configurato (di default
 * `local` → cartella ./uploads). Permette di testare upload/registrazione in
 * locale senza un token Vercel Blob. In produzione si usa il client-upload Blob.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const form = await request.formData();
    const file = form.get('file');
    const scope = String(form.get('scope') ?? 'misc').replace(/[^a-zA-Z0-9._/-]+/g, '');
    if (!(file instanceof File)) {
      return Response.json({ error: 'File mancante' }, { status: 400 });
    }
    // Stesso vincolo di auth del client-upload Blob: lo scope registrazione è esente.
    if (uploadRequiresAuth(`${scope}/`)) {
      const session = await auth();
      if (!session?.user) {
        return Response.json({ error: 'Non autenticato' }, { status: 401 });
      }
    }
    if (!ACCEPTED_MIME.includes(file.type)) {
      return Response.json({ error: 'Formato non supportato (PDF/JPG/PNG)' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json({ error: 'File troppo grande (max 10 MB)' }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const res = await getStorage().put({
      scope,
      buffer,
      originalFilename: file.name,
      mimeType: file.type,
    });
    return Response.json({ key: res.storageKey, name: file.name, size: file.size, type: file.type });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
