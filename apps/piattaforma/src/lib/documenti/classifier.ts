/**
 * Classificatore documentale rule-based (A4).
 *
 * Funzione pura: ricevuto un documento appena uploaded, decide se passa
 * il gating o no in base a regole semplici (MIME, dimensioni, naming).
 * Non sostituisce il classificatore IA (Document AI) — è un primo
 * controllo "ovvio" che intercetta i casi più frequenti di errore
 * (file vuoto, MIME non valido, scan illeggibile da dimensioni assurde).
 *
 * Quando arriva Document AI (Fase 3.3 vera) lo swap è isolato a una
 * funzione: `classifyDocumento` resta il punto di ingresso, l'engine
 * sotto cambia.
 */

export type ClassifierInput = {
  tipo: string;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
};

export type ClassifierResult =
  | { stato: 'PASSED' }
  | { stato: 'FAILED'; reason: string };

/** MIME accettati per i documenti di pratica. */
export const ACCEPTED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/jpg',
] as const;

/** Soglia minima per evitare upload vuoti / placeholder. */
export const MIN_SIZE_BYTES = 30 * 1024; // 30 KB

/** Soglia massima per file (allineata col limite wizard). */
export const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Naming hints per CI fronte/retro: se un file di tipo CI_FRONTE ha nome
 * che contiene "retro"/"back", quasi certamente l'utente ha sbagliato slot.
 * Caso simmetrico per CI_RETRO.
 */
const CI_FRONTE_HINTS = ['retro', 'back', 'verso'];
const CI_RETRO_HINTS = ['fronte', 'front', 'recto'];

export function classifyDocumento(input: ClassifierInput): ClassifierResult {
  // 1. MIME
  if (!(ACCEPTED_MIMES as readonly string[]).includes(input.mimeType)) {
    return {
      stato: 'FAILED',
      reason: `Formato non supportato: ${input.mimeType || 'sconosciuto'}. Accettati PDF, JPG, PNG.`,
    };
  }

  // 2. Size
  if (input.sizeBytes < MIN_SIZE_BYTES) {
    return {
      stato: 'FAILED',
      reason: `File troppo piccolo (${formatSize(input.sizeBytes)}). Probabilmente vuoto o placeholder.`,
    };
  }
  if (input.sizeBytes > MAX_SIZE_BYTES) {
    return {
      stato: 'FAILED',
      reason: `File troppo grande (${formatSize(input.sizeBytes)}). Limite ${formatSize(MAX_SIZE_BYTES)}.`,
    };
  }

  // 3. Visura camerale: SOLO PDF. La visura è multipagina e l'OCR deve leggerla
  // tutta (ATECO, data emissione, sede legale, rappresentante); un'immagine
  // (anche valida come MIME generico) perderebbe pagine → estrazione incompleta.
  if (input.tipo === 'VISURA_CAMERALE' && input.mimeType !== 'application/pdf') {
    return {
      stato: 'FAILED',
      reason: 'La visura camerale deve essere in formato PDF (con tutte le pagine).',
    };
  }

  // 4. Naming hints per CI
  const filenameLower = input.originalFilename.toLowerCase();
  if (input.tipo === 'CI_FRONTE') {
    if (CI_FRONTE_HINTS.some((h) => filenameLower.includes(h))) {
      return {
        stato: 'FAILED',
        reason: 'Il nome del file suggerisce "retro" ma è caricato come "fronte". Verifica.',
      };
    }
  } else if (input.tipo === 'CI_RETRO') {
    if (CI_RETRO_HINTS.some((h) => filenameLower.includes(h))) {
      return {
        stato: 'FAILED',
        reason: 'Il nome del file suggerisce "fronte" ma è caricato come "retro". Verifica.',
      };
    }
  }

  return { stato: 'PASSED' };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
