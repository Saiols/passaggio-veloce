import sharp from 'sharp';
import potrace from 'potrace';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve('.');
const SRC = path.join(ROOT, 'source.png');
const OUT = ROOT;

const NAVY = '#0B1F3A';
const CYAN = '#22D3EE';
const WHITE = '#FFFFFF';

const trace = promisify(potrace.trace);
const posterize = promisify(potrace.posterize);

async function step(label, fn) {
  process.stdout.write(`→ ${label}... `);
  await fn();
  console.log('ok');
}

// 1. Clean transparent PNG: trim empty border, export 1024 master
await step('clean master PNG (1024)', async () => {
  await sharp(SRC)
    .trim({ threshold: 10 })
    .resize({ width: 1024, height: 1024, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, 'logo-master-1024.png'));
});

// 2. Icon-only crop (top portion, no wordmark) for favicons
//    The AI output has icon in upper ~65% and wordmark below. Crop accordingly.
await step('extract icon-only (no wordmark)', async () => {
  const meta = await sharp(SRC).metadata();
  // Heuristic: keep top 72% of trimmed image
  const trimmed = await sharp(SRC).trim({ threshold: 10 }).toBuffer({ resolveWithObject: true });
  const { info } = trimmed;
  const h = Math.round(info.height * 0.72);
  await sharp(trimmed.data)
    .extract({ left: 0, top: 0, width: info.width, height: h })
    .trim({ threshold: 10 })
    .resize({ width: 1024, height: 1024, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(OUT, 'icon-master-1024.png'));
});

// 3. Favicons from icon-master
for (const size of [16, 32, 48, 180, 512]) {
  await step(`favicon ${size}x${size}`, async () => {
    await sharp(path.join(OUT, 'icon-master-1024.png'))
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(OUT, `favicon-${size}.png`));
  });
}

// 4. Navy-background square (social / OpenGraph)
await step('social card 1200x630 (navy bg)', async () => {
  const logo = await sharp(path.join(OUT, 'logo-master-1024.png'))
    .resize({ width: 600, height: 600, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  await sharp({
    create: { width: 1200, height: 630, channels: 4, background: NAVY },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(path.join(OUT, 'social-1200x630-navy.png'));
});

// 5. Monochrome white version (for navy headers): threshold alpha, paint white
await step('monochrome white PNG', async () => {
  const { data, info } = await sharp(path.join(OUT, 'logo-master-1024.png'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    out[i] = 255;
    out[i + 1] = 255;
    out[i + 2] = 255;
    out[i + 3] = a;
  }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(path.join(OUT, 'logo-mono-white-1024.png'));
});

// 6. Vectorize (two passes: full logo, icon only)
await step('vectorize full logo → SVG', async () => {
  // Potrace needs a flat background — composite onto white first
  const flat = await sharp(path.join(OUT, 'logo-master-1024.png'))
    .flatten({ background: '#ffffff' })
    .toBuffer();
  const svg = await posterize(flat, {
    steps: 2,
    color: NAVY,
    background: WHITE,
    threshold: 180,
  });
  await writeFile(path.join(OUT, 'logo.svg'), svg);
});

await step('vectorize icon only → SVG', async () => {
  const flat = await sharp(path.join(OUT, 'icon-master-1024.png'))
    .flatten({ background: '#ffffff' })
    .toBuffer();
  const svg = await posterize(flat, {
    steps: 2,
    color: NAVY,
    background: WHITE,
    threshold: 180,
  });
  await writeFile(path.join(OUT, 'icon.svg'), svg);
});

console.log('\n✓ brand assets generati in docs/brand/');
