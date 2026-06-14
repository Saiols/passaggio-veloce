/** Separatore tra le parti del nome file (numero pratica, targa, …). */
const SEP = ' - ';

/**
 * Caratteri non ammessi in un nome file: separatori di path e caratteri vietati
 * da Windows. NON include il trattino (serve nel codice pratica, es.
 * PV-2026-00042) né lo spazio.
 */
const FORBIDDEN = /[\\/:*?"<>|]/g;

/** Rimuove i caratteri problematici e gli spazi ai bordi da una parte di nome. */
function sanitizePart(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(FORBIDDEN, '').trim();
}

/** Divide base ed estensione (con il punto). Nessuna estensione → ext ''. */
function splitExt(filename: string): { base: string; ext: string } {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return { base: filename, ext: '' };
  return { base: filename.slice(0, dot), ext: filename.slice(dot) };
}

/**
 * Aggiunge le `parts` (es. numero pratica, targa) prima dell'estensione,
 * separate da " - ", saltando quelle vuote/null. Serve a rendere i documenti
 * scaricati univoci e facilmente rintracciabili.
 *
 * Esempi:
 *   appendToFilename('libretto.pdf', 'PV-2026-00042', 'AB123CD')
 *     → 'libretto - PV-2026-00042 - AB123CD.pdf'
 *   appendToFilename('libretto.pdf', 'PV-2026-00042', null)
 *     → 'libretto - PV-2026-00042.pdf'
 */
export function appendToFilename(
  filename: string,
  ...parts: Array<string | null | undefined>
): string {
  const { base, ext } = splitExt(filename);
  const cleanBase = sanitizePart(base) || 'documento';
  const cleanParts = parts.map(sanitizePart).filter((p) => p.length > 0);
  const suffix = cleanParts.length > 0 ? SEP + cleanParts.join(SEP) : '';
  return `${cleanBase}${suffix}${ext}`;
}
