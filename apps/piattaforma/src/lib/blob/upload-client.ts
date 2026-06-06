'use client';

import { upload } from '@vercel/blob/client';

/**
 * Riferimento a un file caricato su Vercel Blob. È il "gettone" che il client
 * passa alle Server Action al posto del File: aggira il limite 4,5 MB sul body
 * delle funzioni serverless (il file va dal browser direttamente a Blob).
 */
export type BlobRef = {
  /** pathname Blob = storageKey persistito su Documento.storageKey */
  key: string;
  name: string;
  size: number;
  type: string;
};

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
export const ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-120);
}

/**
 * Carica un File su Vercel Blob direttamente dal browser e ritorna la BlobRef.
 * `scope` è il prefisso del pathname (es. 'pratiche-staging', 'registrazione').
 * Lancia se il file eccede dimensione/MIME consentiti (controllo ribadito
 * lato server in onBeforeGenerateToken).
 */
export async function uploadToBlob(
  file: File,
  scope: string,
  onProgress?: (pct: number) => void,
): Promise<BlobRef> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('File troppo grande (max 10 MB)');
  }
  if (!ACCEPTED_MIME.includes(file.type)) {
    throw new Error('Formato non supportato (PDF/JPG/PNG)');
  }
  const pathname = `${scope}/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;
  const blob = await upload(pathname, file, {
    access: 'public',
    handleUploadUrl: '/api/blob/upload',
    contentType: file.type,
    onUploadProgress: onProgress
      ? (event) => onProgress(event.percentage)
      : undefined,
  });
  return { key: blob.pathname, name: file.name, size: file.size, type: file.type };
}
