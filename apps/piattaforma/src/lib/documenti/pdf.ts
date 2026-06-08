import { PDFDocument, type PDFImage } from 'pdf-lib';
import sharp from 'sharp';

export type PdfEntry = {
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
};

// Formato A4 in punti PDF (72 dpi).
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 24;

function isPdf(entry: PdfEntry): boolean {
  return entry.mimeType === 'application/pdf' || /\.pdf$/i.test(entry.originalFilename);
}

async function addPdfPages(out: PDFDocument, buffer: Buffer): Promise<void> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pages = await out.copyPages(src, src.getPageIndices());
  for (const page of pages) out.addPage(page);
}

/** Aggiunge l'immagine su una pagina A4 (orientata come l'immagine), scalata
 *  per riempire l'area utile mantenendo le proporzioni e centrata. */
function placeImage(out: PDFDocument, img: PDFImage, w: number, h: number): void {
  const landscape = w > h;
  const pageW = landscape ? A4_H : A4_W;
  const pageH = landscape ? A4_W : A4_H;
  const page = out.addPage([pageW, pageH]);
  const scale = Math.min((pageW - MARGIN * 2) / w, (pageH - MARGIN * 2) / h);
  const drawW = w * scale;
  const drawH = h * scale;
  page.drawImage(img, {
    x: (pageW - drawW) / 2,
    y: (pageH - drawH) / 2,
    width: drawW,
    height: drawH,
  });
}

async function addImagePage(out: PDFDocument, entry: PdfEntry): Promise<void> {
  // Normalizza con sharp: applica l'orientamento EXIF (foto da smartphone) e
  // ricodifica in JPEG baseline RGB — pdf-lib.embedJpg fallisce su CMYK e su
  // alcuni progressive. Se sharp non è disponibile/fallisce, si ripiega
  // sull'embed diretto del buffer originale in base al mime-type.
  try {
    const res = await sharp(entry.buffer)
      .rotate()
      .jpeg({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const img = await out.embedJpg(res.data);
    placeImage(out, img, res.info.width, res.info.height);
    return;
  } catch {
    // fall through al fallback grezzo
  }

  const img =
    entry.mimeType === 'image/png'
      ? await out.embedPng(entry.buffer)
      : await out.embedJpg(entry.buffer);
  placeImage(out, img, img.width, img.height);
}

/**
 * Fonde tutti i documenti di una pratica in un unico PDF:
 * - i documenti PDF vengono copiati pagina per pagina,
 * - le immagini (JPEG/PNG) diventano una pagina A4 ciascuna.
 *
 * Best-effort: un documento illeggibile/corrotto viene saltato. Restituisce
 * `null` se nessuna pagina è stata prodotta (così la route risponde 404).
 */
export async function buildPraticaPdf(entries: readonly PdfEntry[]): Promise<Buffer | null> {
  const out = await PDFDocument.create();
  out.setCreator('Passaggio Veloce');
  out.setProducer('Passaggio Veloce');

  for (const entry of entries) {
    try {
      if (isPdf(entry)) {
        await addPdfPages(out, entry.buffer);
      } else {
        await addImagePage(out, entry);
      }
    } catch {
      // documento illeggibile → salta (come lo storage skip dei file mancanti)
      continue;
    }
  }

  if (out.getPageCount() === 0) return null;
  const bytes = await out.save();
  return Buffer.from(bytes);
}
