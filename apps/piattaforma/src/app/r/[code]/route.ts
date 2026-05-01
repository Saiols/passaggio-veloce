/**
 * Endpoint redirect per il link di affiliazione (FASE 13 + pixel tracking).
 * Pattern: GET /r/<referralCode>?utm_source=...&utm_medium=...&utm_campaign=...
 *
 * Comportamento:
 * 1. Se il code matcha una Company attiva, registra un ReferralClick
 *    (best-effort — un errore nel log NON deve bloccare il redirect).
 * 2. Redirige sempre a /register con ?ref=<code> per non perdere l'attribuzione
 *    in caso di code invalido (sarà ignorato in registerAction).
 *
 * IP minimization: salviamo i primi 3 ottetti per IPv4 e i primi 4 hextet
 * per IPv6 (anonymizzazione standard GDPR-compliant).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@pv/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function anonymizeIp(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.split(',')[0]?.trim() ?? '';
  if (!trimmed) return null;
  if (trimmed.includes(':')) {
    // IPv6 → primi 4 gruppi di hextet
    const parts = trimmed.split(':');
    return parts.slice(0, 4).join(':') + '::';
  }
  // IPv4 → primi 3 ottetti
  const parts = trimmed.split('.');
  if (parts.length !== 4) return trimmed.slice(0, 32);
  return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
}

function truncate(s: string | null, max: number): string | null {
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params;
  const codeNorm = code.trim().toLowerCase().slice(0, 32);

  const url = new URL(req.url);
  const utmSource = truncate(url.searchParams.get('utm_source'), 80);
  const utmMedium = truncate(url.searchParams.get('utm_medium'), 80);
  const utmCampaign = truncate(url.searchParams.get('utm_campaign'), 120);

  // Best-effort: se la company esiste e non è sospesa, logga il click.
  try {
    const company = await prisma.company.findUnique({
      where: { referralCode: codeNorm },
      select: { id: true, deletedAt: true, suspendedAt: true },
    });
    if (company && !company.deletedAt && !company.suspendedAt) {
      const ipRaw =
        req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip');
      const ua = req.headers.get('user-agent');
      await prisma.referralClick.create({
        data: {
          companyId: company.id,
          referralCode: codeNorm,
          ip: anonymizeIp(ipRaw),
          userAgent: truncate(ua, 240),
          utmSource,
          utmMedium,
          utmCampaign,
        },
      });
    }
  } catch {
    // Tracking è best-effort: non blocchiamo il redirect.
  }

  const dest = new URL('/register', url.origin);
  dest.searchParams.set('ref', codeNorm);
  return NextResponse.redirect(dest, 302);
}
