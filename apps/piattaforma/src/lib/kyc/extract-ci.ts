export type CiData = { nome?: string; cognome?: string; rawText: string };

const NAME = String.raw`[A-ZÀ-Ù'’]+(?:[ '’][A-ZÀ-Ù'’]+){0,3}`;

/**
 * Estrae nome/cognome dal testo OCR di una carta d'identità. Gestisce entrambi
 * i layout:
 *  - CARTACEA: etichetta e valore sulla STESSA riga ("Cognome, SAINO" /
 *    "Nome. FEDERICA"), con eventuale punteggiatura inserita dall'OCR.
 *  - CIE elettronica: etichetta da sola, valore sulla riga SUCCESSIVA
 *    ("COGNOME" ↵ "ROSSI").
 */
export function extractCi(text: string): CiData {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const valueFor = (label: 'COGNOME' | 'NOME'): string | undefined => {
    const labelRe = new RegExp(`^${label}\\b`, 'i');
    const i = lines.findIndex((l) => labelRe.test(l));
    if (i === -1) return undefined;
    // 1) valore sulla stessa riga, dopo l'etichetta + eventuale punteggiatura.
    const inline = new RegExp(`^${label}\\b[\\s,.:;-]*(${NAME})`, 'i').exec(lines[i]!);
    if (inline?.[1]) return inline[1].trim().toUpperCase();
    // 2) fallback: valore sulla riga successiva (CIE elettronica).
    const next = lines[i + 1];
    return next && new RegExp(`^${NAME}$`, 'i').test(next) ? next.toUpperCase() : undefined;
  };

  return {
    cognome: valueFor('COGNOME'),
    nome: valueFor('NOME'),
    rawText: text,
  };
}
