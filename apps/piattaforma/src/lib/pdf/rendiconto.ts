import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { prisma } from '@pv/db';
import { formatCurrencyCent, formatDate } from '@/lib/format';

/**
 * Genera un rendiconto PDF mensile separando crediti pratiche da
 * crediti affiliazione (AF-PDF FASE 13.5). Output: Uint8Array con il
 * binario del PDF, da consegnare via response header
 * `Content-Type: application/pdf`.
 *
 * Layout: A4 portrait, font Helvetica, palette navy + slate semplificata
 * (in PDF non possiamo usare CSS variables: i colori sono hard-coded
 * dai pv-tokens del design system).
 */

export type RendicontoPeriod = {
  /** Anno (es. 2026) */
  year: number;
  /** Mese 1-12 */
  month: number;
};

const NAVY = rgb(10 / 255, 37 / 255, 64 / 255); // pv-navy-900
const NAVY_700 = rgb(15 / 255, 76 / 255, 117 / 255);
const SLATE_500 = rgb(100 / 255, 116 / 255, 139 / 255);
const SLATE_700 = rgb(51 / 255, 65 / 255, 85 / 255);
const SLATE_200 = rgb(226 / 255, 232 / 255, 240 / 255);
const ORANGE = rgb(232 / 255, 109 / 255, 33 / 255); // pv-orange-500
const GREEN = rgb(22 / 255, 163 / 255, 74 / 255);

const MONTH_LABELS = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];

export async function generateRendicontoPDF(
  companyId: string,
  period: RendicontoPeriod,
): Promise<Uint8Array> {
  const start = new Date(period.year, period.month - 1, 1, 0, 0, 0, 0);
  const end = new Date(period.year, period.month, 1, 0, 0, 0, 0);

  const [company, transazioni] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        ragioneSociale: true,
        partitaIva: true,
        indirizzo: true,
        citta: true,
        provincia: true,
        cap: true,
      },
    }),
    prisma.transazioneWallet.findMany({
      where: {
        wallet: { companyId },
        createdAt: { gte: start, lt: end },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        pratica: { select: { codicePratica: true, targa: true } },
      },
    }),
  ]);

  if (!company) throw new Error('Azienda non trovata');

  const pratiche = transazioni.filter((t) => t.tipo === 'CREDITO_PRATICA');
  const affiliazione = transazioni.filter(
    (t) => t.tipo === 'CREDITO_AFFILIAZIONE',
  );

  const totalePratiche = pratiche.reduce((s, t) => s + t.importoCent, 0);
  const totaleAffiliazione = affiliazione.reduce(
    (s, t) => s + t.importoCent,
    0,
  );
  const grandTotal = totalePratiche + totaleAffiliazione;

  // ─── Setup PDF ────────────────────────────────────────────────────
  const pdf = await PDFDocument.create();
  pdf.setTitle(
    `Rendiconto ${MONTH_LABELS[period.month - 1]} ${period.year} — ${company.ragioneSociale}`,
  );
  pdf.setAuthor('Passaggio Veloce');

  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([595.28, 841.89]); // A4 portrait
  let y = 800;
  const margin = 48;
  const lineHeight = 14;

  const drawText = (
    p: PDFPage,
    text: string,
    x: number,
    yPos: number,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {},
  ): void => {
    p.drawText(text, {
      x,
      y: yPos,
      size: opts.size ?? 10,
      font: opts.font ?? helv,
      color: opts.color ?? SLATE_700,
    });
  };

  const ensureSpace = (needed: number): void => {
    if (y - needed < margin) {
      page = pdf.addPage([595.28, 841.89]);
      y = 800;
    }
  };

  // ─── Header ───────────────────────────────────────────────────────
  page.drawRectangle({
    x: 0,
    y: 800,
    width: 595.28,
    height: 42,
    color: NAVY,
  });
  drawText(page, 'PASSAGGIO VELOCE', margin, 815, {
    font: helvBold,
    size: 14,
    color: rgb(1, 1, 1),
  });
  drawText(page, 'Rendiconto wallet mensile', 360, 815, {
    font: helv,
    size: 9,
    color: rgb(0.85, 0.85, 0.85),
  });
  y = 770;

  // ─── Titolo periodo ───────────────────────────────────────────────
  drawText(
    page,
    `Rendiconto ${MONTH_LABELS[period.month - 1]} ${period.year}`,
    margin,
    y,
    { font: helvBold, size: 18, color: NAVY },
  );
  y -= 22;
  drawText(page, company.ragioneSociale, margin, y, {
    font: helvBold,
    size: 12,
    color: SLATE_700,
  });
  y -= 14;
  const indirizzo = `${company.indirizzo}, ${company.cap} ${company.citta} (${company.provincia})`;
  drawText(page, indirizzo, margin, y, { size: 9, color: SLATE_500 });
  y -= 12;
  drawText(page, `P.IVA ${company.partitaIva}`, margin, y, {
    size: 9,
    color: SLATE_500,
  });
  y -= 26;

  // ─── Riepilogo totali ─────────────────────────────────────────────
  page.drawRectangle({
    x: margin,
    y: y - 60,
    width: 595.28 - margin * 2,
    height: 60,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: SLATE_200,
    borderWidth: 1,
  });
  drawText(page, 'TOTALE DEL PERIODO', margin + 12, y - 16, {
    font: helvBold,
    size: 9,
    color: SLATE_500,
  });
  drawText(page, formatCurrencyCent(grandTotal), margin + 12, y - 38, {
    font: helvBold,
    size: 22,
    color: NAVY,
  });
  drawText(
    page,
    `${pratiche.length} pratich${pratiche.length === 1 ? 'a' : 'e'} · ${affiliazione.length} commission${affiliazione.length === 1 ? 'e' : 'i'} affiliazione`,
    margin + 12,
    y - 52,
    { size: 9, color: SLATE_500 },
  );
  y -= 80;

  // ─── Sezione PRATICHE ─────────────────────────────────────────────
  ensureSpace(80);
  drawText(page, 'CREDITI DA PRATICHE', margin, y, {
    font: helvBold,
    size: 11,
    color: ORANGE,
  });
  y -= 6;
  page.drawLine({
    start: { x: margin, y },
    end: { x: 595.28 - margin, y },
    thickness: 1,
    color: ORANGE,
  });
  y -= 16;

  if (pratiche.length === 0) {
    drawText(page, 'Nessun credito da pratiche nel periodo.', margin, y, {
      color: SLATE_500,
      size: 10,
    });
    y -= lineHeight;
  } else {
    // Header colonne
    drawText(page, 'Data', margin, y, { font: helvBold, size: 9, color: SLATE_500 });
    drawText(page, 'Pratica', margin + 80, y, { font: helvBold, size: 9, color: SLATE_500 });
    drawText(page, 'Targa', margin + 200, y, { font: helvBold, size: 9, color: SLATE_500 });
    drawText(page, 'Importo', 595.28 - margin - 60, y, {
      font: helvBold, size: 9, color: SLATE_500,
    });
    y -= 12;
    page.drawLine({
      start: { x: margin, y: y + 2 },
      end: { x: 595.28 - margin, y: y + 2 },
      thickness: 0.5,
      color: SLATE_200,
    });
    for (const t of pratiche) {
      ensureSpace(lineHeight + 4);
      drawText(page, formatDate(t.createdAt), margin, y, { size: 9 });
      drawText(
        page,
        t.pratica?.codicePratica ?? t.praticaId?.slice(0, 8) ?? '—',
        margin + 80,
        y,
        { size: 9 },
      );
      drawText(page, t.pratica?.targa ?? '—', margin + 200, y, { size: 9 });
      drawText(
        page,
        formatCurrencyCent(t.importoCent),
        595.28 - margin - 60,
        y,
        { font: helvBold, size: 9, color: GREEN },
      );
      y -= lineHeight;
    }
  }

  y -= 6;
  drawText(page, 'Subtotale pratiche', margin + 200, y, {
    font: helvBold, size: 10, color: SLATE_700,
  });
  drawText(
    page,
    formatCurrencyCent(totalePratiche),
    595.28 - margin - 60,
    y,
    { font: helvBold, size: 10, color: NAVY },
  );
  y -= 26;

  // ─── Sezione AFFILIAZIONE ─────────────────────────────────────────
  ensureSpace(80);
  drawText(page, 'CREDITI DA AFFILIAZIONE', margin, y, {
    font: helvBold,
    size: 11,
    color: NAVY_700,
  });
  y -= 6;
  page.drawLine({
    start: { x: margin, y },
    end: { x: 595.28 - margin, y },
    thickness: 1,
    color: NAVY_700,
  });
  y -= 16;

  if (affiliazione.length === 0) {
    drawText(page, 'Nessun credito da affiliazione nel periodo.', margin, y, {
      color: SLATE_500, size: 10,
    });
    y -= lineHeight;
  } else {
    drawText(page, 'Data', margin, y, { font: helvBold, size: 9, color: SLATE_500 });
    drawText(page, 'Pratica origine', margin + 80, y, {
      font: helvBold, size: 9, color: SLATE_500,
    });
    drawText(page, 'Importo', 595.28 - margin - 60, y, {
      font: helvBold, size: 9, color: SLATE_500,
    });
    y -= 12;
    page.drawLine({
      start: { x: margin, y: y + 2 },
      end: { x: 595.28 - margin, y: y + 2 },
      thickness: 0.5, color: SLATE_200,
    });
    for (const t of affiliazione) {
      ensureSpace(lineHeight + 4);
      drawText(page, formatDate(t.createdAt), margin, y, { size: 9 });
      drawText(
        page,
        t.pratica?.codicePratica ?? '—',
        margin + 80,
        y,
        { size: 9 },
      );
      drawText(
        page,
        formatCurrencyCent(t.importoCent),
        595.28 - margin - 60,
        y,
        { font: helvBold, size: 9, color: GREEN },
      );
      y -= lineHeight;
    }
  }

  y -= 6;
  drawText(page, 'Subtotale affiliazione', margin + 200, y, {
    font: helvBold, size: 10, color: SLATE_700,
  });
  drawText(
    page,
    formatCurrencyCent(totaleAffiliazione),
    595.28 - margin - 60,
    y,
    { font: helvBold, size: 10, color: NAVY },
  );
  y -= 30;

  // ─── Footer fisso (ultima pagina) ─────────────────────────────────
  drawText(
    page,
    'Documento generato automaticamente da Passaggio Veloce. Conserva ai fini fiscali.',
    margin,
    margin - 10,
    { size: 8, color: SLATE_500 },
  );
  drawText(
    page,
    `Generato il ${formatDate(new Date())}`,
    595.28 - margin - 100,
    margin - 10,
    { size: 8, color: SLATE_500 },
  );

  return await pdf.save();
}
