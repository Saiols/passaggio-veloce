import 'server-only';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { env } from '@/env';
import type { VisuraData } from './visura-parser';
import type { CiData } from './extract-ci';
import type { CfData } from './extract-cf';

export type KycExtracted = { visura: VisuraData; ci: CiData; cf: CfData };

// Validità del token KYC: la verifica fatta allo step Documenti vale per il
// submit entro questa finestra; oltre, il registerAction ri-esegue l'OCR.
const TTL_MS = 30 * 60 * 1000;

/** Hash stabile dei buffer dei documenti sottoposti a OCR (lega il token ai file). */
export function hashDocs(buffers: Buffer[]): string {
  const h = createHash('sha256');
  for (const b of buffers) {
    h.update(String(b.length));
    h.update('|');
    h.update(b);
  }
  return h.digest('hex');
}

/** Rimuove il testo OCR grezzo (PII pesante, non necessario a valle/nel token). */
function stripRawText(e: KycExtracted): KycExtracted {
  return {
    visura: { ...e.visura, rawText: '' },
    ci: { ...e.ci, rawText: '' },
    cf: { ...e.cf, rawText: '' },
  };
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64url = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

/**
 * Firma un token che attesta l'esito KYC per uno specifico set di documenti.
 * Stateless: contiene hash dei file + dati estratti + scadenza, firmato HMAC.
 */
export function signKycToken(docsHash: string, extracted: KycExtracted, now: number): string {
  const payload = JSON.stringify({ h: docsHash, e: stripRawText(extracted), x: now + TTL_MS });
  const body = b64url(payload);
  const sig = createHmac('sha256', env.AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Verifica un token KYC: firma valida, non scaduto, e legato ESATTAMENTE ai file
 * passati (docsHash). Se valido ritorna i dati estratti (così il submit non
 * ri-esegue l'OCR). Confronto firma in tempo costante.
 */
export function verifyKycToken(
  token: string,
  docsHash: string,
  now: number,
): { valid: true; extracted: KycExtracted } | { valid: false } {
  const dot = token.indexOf('.');
  if (dot <= 0) return { valid: false };
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', env.AUTH_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false };
  let parsed: { h?: unknown; e?: unknown; x?: unknown };
  try {
    parsed = JSON.parse(unb64url(body));
  } catch {
    return { valid: false };
  }
  if (typeof parsed.x !== 'number' || parsed.x < now) return { valid: false };
  if (parsed.h !== docsHash) return { valid: false };
  return { valid: true, extracted: parsed.e as KycExtracted };
}
