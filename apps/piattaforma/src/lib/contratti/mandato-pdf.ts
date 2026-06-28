import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { DatiFiscali } from '@/lib/fatturazione/pv-emittente';
import { wrapText } from '@/lib/fatturazione/pdf';
import { winAnsiSafe } from '@/lib/pdf/winansi';
import { MANDATO_TITOLO, MANDATO_CLAUSOLE } from './testo';

export type MandatoPdfInput = {
  mandante: DatiFiscali;
  mandanteRappresentante: string;
  mandatario: DatiFiscali;
  mandatarioRappresentante: string;
  foro: string;
  firmatoAt: Date;
  otpAudit: { ip: string | null };
};

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 56;
const NAVY = rgb(0.04, 0.15, 0.25);
const SLATE = rgb(0.2, 0.25, 0.33);

function indirizzo(d: DatiFiscali): string {
  return [d.indirizzo, [d.cap, d.citta].filter(Boolean).join(' '), d.provincia ? `(${d.provincia})` : '']
    .filter(Boolean)
    .join(', ');
}

function formatData(d: Date): string {
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export async function buildMandatoFatturazionePdf(input: MandatoPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Mandato fatturazione conto terzi');
  pdf.setAuthor('Passaggio Veloce');
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  const maxW = PAGE_W - 2 * MARGIN;

  const ensureSpace = (needed: number): void => {
    if (y - needed < MARGIN) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  const draw = (t: string, font: PDFFont, size: number, color = SLATE): void => {
    const lines = wrapText(t, font, size, maxW);
    for (const line of lines) {
      ensureSpace(size + 4);
      page.drawText(winAnsiSafe(line), { x: MARGIN, y, size, font, color });
      y -= size + 4;
    }
  };
  const gap = (h: number): void => {
    y -= h;
  };

  // Titolo
  draw(MANDATO_TITOLO, bold, 15, NAVY);
  gap(8);
  draw('Tra le parti sotto indicate:', helv, 10);
  gap(4);

  // Parti
  draw(
    `Mandante: ${input.mandante.ragioneSociale}, con sede in ${indirizzo(input.mandante)}, ` +
      `C.F./P. IVA ${input.mandante.partitaIva}, in persona di ${input.mandanteRappresentante || '—'}, di seguito "Mandante".`,
    helv,
    10,
  );
  gap(2);
  draw(
    `Mandatario: ${input.mandatario.ragioneSociale}, con sede in ${indirizzo(input.mandatario)}, ` +
      `C.F./P. IVA ${input.mandatario.partitaIva}, in persona di ${input.mandatarioRappresentante}, di seguito "Mandatario".`,
    helv,
    10,
  );
  gap(10);

  // Clausole
  for (const c of MANDATO_CLAUSOLE) {
    draw(c.heading, bold, 11, NAVY);
    gap(2);
    draw(c.body.replaceAll('{{FORO}}', input.foro), helv, 10);
    gap(8);
  }

  // Sottoscrizione
  gap(6);
  draw(`Luogo e data: ${input.mandatario.citta}, ${formatData(input.firmatoAt)}`, helv, 10);
  gap(4);
  draw(
    `Firma del Mandante: ${input.mandanteRappresentante || '—'} — firmato elettronicamente via codice OTP ` +
      `il ${formatData(input.firmatoAt)}${input.otpAudit.ip ? ` (IP ${input.otpAudit.ip})` : ''}, codice verificato.`,
    helv,
    10,
    NAVY,
  );
  gap(2);
  draw(
    `Firma del Mandatario: ${input.mandatarioRappresentante} per ${input.mandatario.ragioneSociale}.`,
    helv,
    10,
  );

  return await pdf.save();
}
