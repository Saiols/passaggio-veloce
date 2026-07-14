export type CiData = { nome?: string; cognome?: string; rawText: string };

const NAME = String.raw`[A-ZÀ-Ù'’]+(?:[ '’][A-ZÀ-Ù'’]+){0,3}`;

/** Traduzione inglese stampata sulla CIE accanto all'etichetta italiana
 * ("COGNOME / SURNAME", "NOME / NAME"): non è mai un valore. */
const TRADUZIONE = { COGNOME: 'SURNAME', NOME: 'NAME' } as const;

/**
 * Estrae nome/cognome dal testo OCR di una carta d'identità. Gestisce entrambi
 * i layout:
 *  - CARTACEA: etichetta e valore sulla STESSA riga ("Cognome, SAINO" /
 *    "Nome. FEDERICA"), con eventuale punteggiatura inserita dall'OCR.
 *  - CIE elettronica: etichetta da sola, valore sulla riga SUCCESSIVA
 *    ("COGNOME" ↵ "ROSSI").
 *
 * Sulla CIE l'etichetta è bilingue e la barra che separa le due lingue è un
 * glifo sottile che l'OCR perde spesso (riflessi, stampa consumata): la riga
 * diventa "NOME NAME" o "NOMENAME", e senza precauzioni la traduzione inglese
 * verrebbe scambiata per il valore. Qui l'etichetta bilingue viene riconosciuta
 * e scartata in tutte e tre le forme (con barra, senza barra, spezzata su due
 * righe).
 */
export function extractCi(text: string): CiData {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const valueFor = (label: 'COGNOME' | 'NOME'): string | undefined => {
    const en = TRADUZIONE[label];
    const labelRe = new RegExp(`^${label}\\b`, 'i');
    // Etichetta bilingue sulla stessa riga: la barra può mancare o essere stata
    // letta come un altro segno ("NOME / NAME", "NOME NAME", "NOMENAME").
    const bilingueRe = new RegExp(`^${label}\\s*[^A-ZÀ-Ù]?\\s*${en}\\b`, 'i');
    const i = lines.findIndex((l) => labelRe.test(l) || bilingueRe.test(l));
    if (i === -1) return undefined;
    // 1) valore sulla stessa riga, dopo l'etichetta + eventuale punteggiatura.
    const riga = lines[i]!.replace(bilingueRe, label);
    const inline = new RegExp(`^${label}\\b[\\s,.:;-]*(${NAME})`, 'i').exec(riga);
    if (inline?.[1]) return inline[1].trim().toUpperCase();
    // 2) fallback: valore sulla riga successiva (CIE elettronica), saltando la
    // traduzione inglese se l'OCR l'ha messa su una riga tutta sua.
    const enRe = new RegExp(`^${en}$`, 'i');
    const next = lines[i + 1] && enRe.test(lines[i + 1]!) ? lines[i + 2] : lines[i + 1];
    return next && new RegExp(`^${NAME}$`, 'i').test(next) ? next.toUpperCase() : undefined;
  };

  return {
    cognome: valueFor('COGNOME'),
    nome: valueFor('NOME'),
    rawText: text,
  };
}
