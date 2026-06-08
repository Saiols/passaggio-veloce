import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { buildPraticaPdf } from './pdf';

async function makePng(width = 40, height = 60): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
}

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 300]);
  return Buffer.from(await doc.save());
}

describe('buildPraticaPdf', () => {
  it('returns null when there are no entries', async () => {
    expect(await buildPraticaPdf([])).toBeNull();
  });

  it('merges images and PDFs into one PDF (a page per image, all PDF pages)', async () => {
    const png = await makePng();
    const pdf = await makePdf(2);
    const out = await buildPraticaPdf([
      { buffer: png, mimeType: 'image/png', originalFilename: 'doc.png' },
      { buffer: pdf, mimeType: 'application/pdf', originalFilename: 'altro.pdf' },
    ]);
    expect(out).not.toBeNull();
    expect(out!.subarray(0, 5).toString()).toBe('%PDF-');
    const reloaded = await PDFDocument.load(out!);
    expect(reloaded.getPageCount()).toBe(3); // 1 immagine + 2 pagine del pdf
  });

  it('skips unreadable entries but keeps the valid ones', async () => {
    const png = await makePng();
    const out = await buildPraticaPdf([
      { buffer: Buffer.from('not-an-image'), mimeType: 'image/png', originalFilename: 'bad.png' },
      { buffer: png, mimeType: 'image/png', originalFilename: 'good.png' },
    ]);
    expect(out).not.toBeNull();
    const reloaded = await PDFDocument.load(out!);
    expect(reloaded.getPageCount()).toBe(1);
  });
});
