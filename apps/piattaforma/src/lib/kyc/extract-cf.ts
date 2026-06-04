export type CfData = { codiceFiscale?: string; rawText: string };

const CF_RE = /\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/;

/** Estrae il codice fiscale dal testo OCR (tessera sanitaria / CF). */
export function extractCf(text: string): CfData {
  const m = CF_RE.exec(text.toUpperCase());
  return { codiceFiscale: m?.[1], rawText: text };
}
