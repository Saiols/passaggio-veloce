/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from 'next/og';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND } from '@/lib/seo/brand';

// Node runtime (default per opengraph-image.tsx in Next 16) consente fs.
// Edge runtime sarebbe più veloce ma dovremmo embeddare il logo come stringa.
export const runtime = 'nodejs';

export const alt = `${BRAND.shortName} — Broker digitale per passaggi di proprietà auto`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  // Legge il logo SVG dal filesystem e lo inietta inline come <img src="data:...">.
  // Fallback grazioso: se il file non c'è, l'OG si genera senza logo (testo only).
  let logoDataUri: string | null = null;
  try {
    const logoBuffer = readFileSync(
      join(process.cwd(), 'public', 'brand', 'logo-mono-white.svg'),
    );
    logoDataUri = `data:image/svg+xml;base64,${logoBuffer.toString('base64')}`;
  } catch {
    logoDataUri = null;
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 80px',
          background: 'linear-gradient(135deg, #0b1e3a 0%, #1e3a8a 100%)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#ffffff',
        }}
      >
        {/* Top: badge dominio */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            fontSize: 22,
            opacity: 0.65,
            fontFamily: 'monospace',
          }}
        >
          passaggioveloce.it
        </div>

        {/* Middle: titolo + sottotitolo */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {logoDataUri ? (
            <img
              src={logoDataUri}
              alt=""
              width={420}
              height={72}
              style={{ marginBottom: 16 }}
            />
          ) : null}
          <div
            style={{
              fontSize: 78,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
            }}
          >
            Passaggio Veloce
          </div>
          <div
            style={{
              fontSize: 36,
              lineHeight: 1.25,
              color: '#b8cdea',
              maxWidth: 900,
            }}
          >
            Broker digitale per passaggi di proprietà auto.
          </div>
        </div>

        {/* Bottom: pill compliance */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div
            style={{
              display: 'flex',
              padding: '12px 22px',
              borderRadius: 999,
              background: '#f97316',
              color: '#ffffff',
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: '0.04em',
            }}
          >
            ACI · GDPR · SDI
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
