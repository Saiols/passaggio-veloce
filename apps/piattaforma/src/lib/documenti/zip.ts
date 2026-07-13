import type { Readable } from 'node:stream';
import JSZip from 'jszip';
import { documentoDownloadName } from './labels';

export type ZipEntry = { name: string; buffer: Buffer };

/** Drena un Node Readable in un unico Buffer. */
export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Nome leggibile dell'entry zip: "<codicePratica> - <label>[ - <owner>] - <n>".
 * Il nome file originale NON viene esposto; l'indice garantisce l'unicità tra
 * documenti dello stesso tipo/owner nella stessa pratica.
 */
export function zipEntryName(
  doc: { tipo: string; owner: string | null; originalFilename: string },
  index: number,
  opts?: { codicePratica?: string | null },
): string {
  return documentoDownloadName(doc, { codicePratica: opts?.codicePratica, index });
}

/** Costruisce uno zip in-memory dalle entry. Pura (no I/O). */
export async function buildDocumentiZip(entries: readonly ZipEntry[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const e of entries) {
    zip.file(e.name, e.buffer);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
