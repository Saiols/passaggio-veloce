import { classifyDocumento } from './classifier';

export type GatingCandidate = {
  owner: 'venditore' | 'acquirente';
  tipo: string;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
};

export type BlockingDocument = {
  owner: 'venditore' | 'acquirente';
  tipo: string;
  reason: string;
};

/**
 * Dato l'elenco dei documenti di parte allegati alla pratica, restituisce
 * quelli che NON passano il gating rule-based (classifyDocumento -> FAILED).
 * Se la lista e' vuota, il submit puo' procedere. Funzione pura: nessun I/O.
 */
export function findBlockingDocuments(
  candidates: readonly GatingCandidate[],
): BlockingDocument[] {
  const blocking: BlockingDocument[] = [];
  for (const c of candidates) {
    const res = classifyDocumento({
      tipo: c.tipo,
      mimeType: c.mimeType,
      sizeBytes: c.sizeBytes,
      originalFilename: c.originalFilename,
    });
    if (res.stato === 'FAILED') {
      blocking.push({ owner: c.owner, tipo: c.tipo, reason: res.reason });
    }
  }
  return blocking;
}
