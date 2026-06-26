import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { DocumentoFiscaleTipo, FatturaPaTipo } from '@pv/db';
import { formatCurrencyCent, formatDate } from '@/lib/format';
import { numeroDocumento, labelTipoDocumento } from './format';
import { winAnsiSafe } from '@/lib/pdf/winansi';
import type { DatiFiscali } from './pv-emittente';
import type { SedeRiferimento } from './descrizione';

/**
 * Genera on-the-fly il PDF di un DocumentoFiscale (fattura PV, compenso
 * intermediazione broker, nota di credito, penale). Output: `Uint8Array`
 * da servire con `Content-Type: application/pdf`.
 *
 * Layout A4 portrait, font Helvetica, palette navy/slate hard-coded (i
 * pv-token del design system; in PDF non esistono CSS variables). Pensato
 * per essere una rappresentazione leggibile e conservabile del documento —
 * NON è l'XML FatturaPA legale (quello dipende dal commercialista, B1).
 */

export type DocumentoPdfInput = {
  tipo: DocumentoFiscaleTipo;
  fatturaPaTipo: FatturaPaTipo | null;
  numeroProgressivo: number;
  anno: number;
  emessoAt: Date;
  emittente: DatiFiscali;
  destinatario: DatiFiscali;
  imponibileCent: number | null;
  ivaCent: number | null;
  aliquotaIvaPct: number | null;
  importoLordoCent: number;
  /** Descrizione della riga documento. */
  descrizione: string;
  /** Riferimento testuale (es. "Pratica PV-2026-00042" o "Payout del …"). */
  riferimento?: string | null;
  /**
   * Sede operativa a cui il documento si riferisce (multi-sede). I dati fiscali
   * restano della madre; la sede è mostrata accanto alla parte indicata da `lato`.
   */
  sede?: SedeRiferimento | null;
};

const NAVY = rgb(10 / 255, 37 / 255, 64 / 255);
const NAVY_700 = rgb(15 / 255, 76 / 255, 117 / 255);
const SLATE_500 = rgb(100 / 255, 116 / 255, 139 / 255);
const SLATE_700 = rgb(51 / 255, 65 / 255, 85 / 255);
const SLATE_200 = rgb(226 / 255, 232 / 255, 240 / 255);
const ORANGE = rgb(232 / 255, 109 / 255, 33 / 255);
const RED = rgb(220 / 255, 38 / 255, 38 / 255);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;

function indirizzoLinea(d: DatiFiscali): string {
  return [d.indirizzo, [d.cap, d.citta].filter(Boolean).join(' '), d.provincia ? `(${d.provincia})` : '']
    .filter(Boolean)
    .join(', ');
}

function sedeLinea(s: { nome: string; citta: string; provincia: string }): string {
  const loc = [s.citta, s.provincia ? `(${s.provincia})` : ''].filter(Boolean).join(' ');
  return loc ? `${s.nome} · ${loc}` : s.nome;
}

/**
 * Spezza un testo in righe che stanno entro `maxWidth` punti, misurando con il
 * font reale (così la descrizione lunga non sovrasta la colonna importi). La
 * misura usa il testo già reso WinAnsi-safe per restare coerente col disegno.
 */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = winAnsiSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (cur && font.widthOfTextAtSize(trial, size) > maxWidth) {
      lines.push(cur);
      cur = w;
    } else {
      cur = trial;
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [''];
}

export async function buildDocumentoPdf(input: DocumentoPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const tipoLabel = labelTipoDocumento(input.tipo);
  const numero = numeroDocumento(input);
  pdf.setTitle(`${tipoLabel} N° ${numero} — ${input.emittente.ragioneSociale}`);
  pdf.setAuthor('Passaggio Veloce');

  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  const text = (
    p: PDFPage,
    t: string,
    x: number,
    y: number,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {},
  ): void => {
    // Lo StandardFont supporta solo WinAnsi/CP1252: i dati anagrafici reali
    // possono contenere caratteri fuori da quel set (vedi winAnsiSafe), che
    // altrimenti farebbero lanciare drawText con «WinAnsi cannot encode …».
    p.drawText(winAnsiSafe(t), {
      x,
      y,
      size: opts.size ?? 10,
      font: opts.font ?? helv,
      color: opts.color ?? SLATE_700,
    });
  };

  const negativa = input.importoLordoCent < 0;
  const totaleColor = negativa ? RED : NAVY;

  // ─── Header brand ────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: PAGE_H - 42, width: PAGE_W, height: 42, color: NAVY });
  const logoX = MARGIN;
  const logoTopY = PAGE_H - 9;
  const logoScale = 0.42;
  page.drawSvgPath('M14 8 H38 L52 22 V58 H14 Z', { x: logoX, y: logoTopY, scale: logoScale, color: rgb(1, 1, 1) });
  page.drawSvgPath('M37 13 L26 33 L34 33 L29 51 L46 29 L38 29 Z', {
    x: logoX,
    y: logoTopY,
    scale: logoScale,
    color: ORANGE,
    borderColor: rgb(1, 1, 1),
    borderWidth: 1.2,
  });
  text(page, 'PASSAGGIO VELOCE', MARGIN + 36, PAGE_H - 27, { font: helvBold, size: 14, color: rgb(1, 1, 1) });
  text(page, 'Documento fiscale', PAGE_W - MARGIN - 110, PAGE_H - 27, {
    font: helv,
    size: 9,
    color: rgb(0.85, 0.85, 0.85),
  });

  let y = PAGE_H - 80;

  // ─── Titolo documento ────────────────────────────────────────────
  text(page, tipoLabel.toUpperCase() + (input.fatturaPaTipo ? ` · ${input.fatturaPaTipo}` : ''), MARGIN, y, {
    font: helvBold,
    size: 10,
    color: SLATE_500,
  });
  y -= 22;
  text(page, `N° ${numero}`, MARGIN, y, { font: helvBold, size: 20, color: NAVY });
  text(page, `Emesso il ${formatDate(input.emessoAt)}`, PAGE_W - MARGIN - 150, y + 4, { size: 10, color: SLATE_500 });
  y -= 30;

  // ─── Emittente / Destinatario ────────────────────────────────────
  const colW = (PAGE_W - MARGIN * 2 - 20) / 2;
  // Gap di sicurezza: i campi vanno a capo entro la colonna così i valori
  // lunghi (ragione sociale, indirizzo, PEC) non arrivano al bordo laterale.
  const PARTE_GAP = 6;
  const drawParte = (titolo: string, d: DatiFiscali, x: number, sede?: SedeRiferimento | null): void => {
    let yy = y;
    text(page, titolo, x, yy, { font: helvBold, size: 9, color: SLATE_500 });
    yy -= 15;
    // Disegna un campo andando a capo entro la larghezza colonna; avanza yy
    // di una riga per ogni riga prodotta.
    const drawField = (
      value: string,
      opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> },
      lh: number,
    ): void => {
      const lines = wrapText(value, opts.font ?? helv, opts.size ?? 9, colW - PARTE_GAP);
      lines.forEach((ln, i) => text(page, ln, x, yy - i * lh, opts));
      yy -= lines.length * lh;
    };
    drawField(d.ragioneSociale, { font: helvBold, size: 11, color: NAVY }, 14);
    if (sede) drawField(`Sede: ${sedeLinea(sede)}`, { font: helvBold, size: 9, color: NAVY_700 }, 13);
    drawField(`P.IVA ${d.partitaIva}`, { size: 9 }, 12);
    const addr = indirizzoLinea(d);
    if (addr) drawField(addr, { size: 9 }, 12);
    if (d.codiceSdi) drawField(`SDI ${d.codiceSdi}`, { size: 9 }, 12);
    if (d.pec) drawField(`PEC ${d.pec}`, { size: 9 }, 12);
  };
  drawParte('EMITTENTE', input.emittente, MARGIN, input.sede?.lato === 'emittente' ? input.sede : null);
  drawParte(
    'DESTINATARIO',
    input.destinatario,
    MARGIN + colW + 20,
    input.sede?.lato === 'destinatario' ? input.sede : null,
  );
  y -= 110;

  // ─── Tabella riga documento ──────────────────────────────────────
  const colImp = PAGE_W - MARGIN - 320;
  const colIva = PAGE_W - MARGIN - 200;
  const colTot = PAGE_W - MARGIN - 90;
  text(page, 'DESCRIZIONE', MARGIN, y, { font: helvBold, size: 9, color: SLATE_500 });
  text(page, 'IMPONIBILE', colImp, y, { font: helvBold, size: 9, color: SLATE_500 });
  text(page, 'IVA', colIva, y, { font: helvBold, size: 9, color: SLATE_500 });
  text(page, 'TOTALE', colTot, y, { font: helvBold, size: 9, color: SLATE_500 });
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: NAVY_700 });
  y -= 16;

  // Importi allineati alla PRIMA riga della descrizione.
  text(page, formatCurrencyCent(input.imponibileCent ?? input.importoLordoCent), colImp, y, { size: 10 });
  text(
    page,
    input.aliquotaIvaPct ? `${formatCurrencyCent(input.ivaCent ?? 0)} (${input.aliquotaIvaPct}%)` : '—',
    colIva,
    y,
    { size: 10 },
  );
  text(page, formatCurrencyCent(input.importoLordoCent), colTot, y, {
    font: helvBold,
    size: 10,
    color: totaleColor,
  });

  // Descrizione: a capo entro lo spazio fino alla colonna IMPONIBILE (con gap).
  const DESC_LH = 12;
  const descLines = wrapText(input.descrizione, helv, 10, colImp - MARGIN - 12);
  descLines.forEach((line, i) => {
    text(page, line, MARGIN, y - i * DESC_LH, { size: 10, color: SLATE_700 });
  });
  y -= (descLines.length - 1) * DESC_LH;

  if (input.riferimento) {
    y -= 13;
    // Anche il riferimento (es. payout con più pratiche) va a capo a tutta larghezza.
    const refLines = wrapText(input.riferimento, helv, 8.5, PAGE_W - MARGIN * 2);
    refLines.forEach((line, i) => {
      text(page, line, MARGIN, y - i * 11, { size: 8.5, color: SLATE_500 });
    });
    y -= (refLines.length - 1) * 11;
  }
  y -= 14;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: SLATE_200 });
  y -= 24;

  // ─── Totale ──────────────────────────────────────────────────────
  page.drawRectangle({
    x: PAGE_W - MARGIN - 240,
    y: y - 36,
    width: 240,
    height: 44,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: SLATE_200,
    borderWidth: 1,
  });
  text(page, 'TOTALE DOCUMENTO', PAGE_W - MARGIN - 228, y - 12, { font: helvBold, size: 9, color: SLATE_500 });
  text(page, formatCurrencyCent(input.importoLordoCent), PAGE_W - MARGIN - 228, y - 30, {
    font: helvBold,
    size: 18,
    color: totaleColor,
  });
  y -= 60;

  // ─── Diciture / regime ───────────────────────────────────────────
  const noIva = (input.ivaCent ?? 0) === 0 && (input.aliquotaIvaPct ?? 0) === 0;
  if (input.tipo === 'NOTA_VARIAZIONE') {
    text(page, 'Documento di rettifica (nota di variazione in diminuzione).', MARGIN, y, {
      size: 8.5,
      color: SLATE_500,
    });
    y -= 12;
  } else if (noIva && input.importoLordoCent > 0) {
    text(
      page,
      'Operazione senza applicazione IVA — regime forfettario (art. 1, c. 54-89, L. 190/2014).',
      MARGIN,
      y,
      { size: 8.5, color: SLATE_500 },
    );
    y -= 12;
  }

  // ─── Footer (centrato, una frase per riga) ───────────────────────
  const drawCentered = (line: string, yy: number, size: number): void => {
    const w = helv.widthOfTextAtSize(winAnsiSafe(line), size);
    text(page, line, (PAGE_W - w) / 2, yy, { size, color: SLATE_500 });
  };
  const footerLines = [
    'Rappresentazione conservabile del documento generata da Passaggio Veloce.',
    'Non sostituisce il documento fiscale emesso allo SdI dal commercialista.',
  ];
  footerLines.forEach((line, i) => {
    drawCentered(line, MARGIN - 10 + (footerLines.length - 1 - i) * 10, 8);
  });

  return await pdf.save();
}
