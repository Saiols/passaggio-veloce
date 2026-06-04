export type CiData = { nome?: string; cognome?: string; rawText: string };

/** Estrae nome/cognome dal testo OCR di una CI/CIE. Best-effort: cerca le
 * etichette COGNOME/NOME (la riga successiva contiene il valore). */
export function extractCi(text: string): CiData {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const valueAfter = (label: RegExp): string | undefined => {
    const i = lines.findIndex((l) => label.test(l));
    if (i === -1) return undefined;
    const v = lines[i + 1];
    return v && /^[A-ZÀ-Ù'' ]{2,}$/i.test(v) ? v.toUpperCase() : undefined;
  };
  return {
    cognome: valueAfter(/^COGNOME\b/i),
    nome: valueAfter(/^NOME\b/i),
    rawText: text,
  };
}
