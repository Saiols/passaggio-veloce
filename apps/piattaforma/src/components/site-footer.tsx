import Link from 'next/link';
import { BRAND } from '@/lib/seo/brand';

export function SiteFooter() {
  return (
    <footer className="mt-auto bg-pv-navy-900 text-pv-slate-300">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_auto]">
          <address className="not-italic text-[13px] leading-relaxed">
            <p className="font-bold text-white">{BRAND.legalName}</p>
            <p>
              {BRAND.address.street} — {BRAND.address.postalCode} {BRAND.address.city} ({BRAND.address.region})
            </p>
            <p>
              P.IVA {BRAND.vatId} ·{' '}
              <a href={`mailto:${BRAND.email}`} className="hover:text-white">
                {BRAND.email}
              </a>{' '}
              ·{' '}
              <a href={`tel:${BRAND.phoneE164}`} className="hover:text-white">
                {BRAND.phoneDisplay}
              </a>
            </p>
          </address>
          <nav className="flex flex-wrap items-start gap-3 text-[12px]">
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/cookie" className="hover:text-white">Cookie</Link>
            <Link href="/termini" className="hover:text-white">Termini</Link>
          </nav>
        </div>
        <div className="mt-6 flex flex-col items-start justify-between gap-2 border-t border-pv-navy-800 pt-4 text-[12px] sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} {BRAND.shortName} · Tutti i diritti riservati</p>
          <span className="font-mono text-[11px] text-pv-slate-500/70">
            build {(process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7)}
          </span>
        </div>
      </div>
    </footer>
  );
}
