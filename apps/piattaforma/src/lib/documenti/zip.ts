import type { Readable } from 'node:stream';
import JSZip from 'jszip';

export type ZipEntry = { name: string; buffer: Buffer };

/** Drena un Node Readable in un unico Buffer. */
export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Estrae l'estensione dal filename originale (fallback "bin"). */
function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return 'bin';
  return filename.slice(dot + 1).toLowerCase();
}

/** Nome leggibile dell'entry zip: "<n>-<tipo>[-<owner>].<ext>". */
export function zipEntryName(
  doc: { tipo: string; owner: string | null; originalFilename: string },
  index: number,
): string {
  const ext = extOf(doc.originalFilename);
  const ownerPart = doc.owner ? `-${doc.owner}` : '';
  return `${index + 1}-${doc.tipo}${ownerPart}.${ext}`;
}

/** Costruisce uno zip in-memory dalle entry. Pura (no I/O). */
export async function buildPraticaZip(entries: readonly ZipEntry[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const e of entries) {
    zip.file(e.name, e.buffer);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
