import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn, ToastProvider } from '@/components/ui';
import { NavBadge } from '@/components/nav-badge';
import { logoutAction } from '@/app/(auth)/actions';
import { DemoBanner } from '@/components/demo-banner';
import { AdminShell } from '@/components/admin/admin-shell';

export type AppShellSession = {
  user: {
    name?: string | null;
    email?: string | null;
    role?: string;
    companyType?: string;
    companyName?: string | null;
  };
};

type NavLink = { href: string; label: string };

function navForRole(role: string | undefined, companyType: string | undefined): NavLink[] {
  // NOTA: lo staff di piattaforma (ADMIN_PIATTAFORMA / ASSISTENTE) NON passa più
  // di qui — AppShell fa un early-return verso AdminShell (sidebar CRM). Questo
  // ramo resta solo come riferimento storico; la nav admin "viva" è la lista
  // NAV_GROUPS in components/admin/admin-shell.tsx (stessi href e stessi permessi).
  if (role === 'ADMIN_PIATTAFORMA' || role === 'ASSISTENTE') {
    const adminLinks: NavLink[] = [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/admin/pratiche', label: 'Pratiche' },
      { href: '/admin/broker', label: 'Broker' },
      { href: '/admin/agenzie', label: 'Agenzie' },
      { href: '/admin/utenti', label: 'Utenti' },
      { href: '/admin/crm', label: 'CRM' },
      { href: '/admin/escalation', label: 'Escalation' },
    ];
    if (role === 'ADMIN_PIATTAFORMA') {
      adminLinks.splice(1, 0, { href: '/admin/dashboard', label: 'Finanze' });
      adminLinks.push({ href: '/admin/segnalazioni', label: 'Segnalazioni' });
      adminLinks.push({ href: '/admin/revisioni', label: 'Revisioni' });
      adminLinks.push({ href: '/admin/affiliazioni', label: 'Affiliazioni' });
      adminLinks.push({ href: '/admin/codici-promozionali', label: 'Promo' });
      adminLinks.push({ href: '/admin/ateco', label: 'ATECO' });
      adminLinks.push({ href: '/admin/assistenti', label: 'Assistenti' });
      adminLinks.push({ href: '/admin/audit-log', label: 'Audit log' });
      // LISTINI DISABILITATI (feature nascosta 2026-06-12) — riattivare con /admin/listini:
      // adminLinks.push({ href: '/admin/listini', label: 'Listini' });
    }
    return adminLinks;
  }
  const links: NavLink[] =
    companyType === 'AGENZIA'
      ? [
          { href: '/dashboard', label: 'Dashboard' },
          { href: '/inbox', label: 'Inbox' },
          { href: '/pratiche', label: 'Pratiche attive' },
          { href: '/feedback', label: 'Feedback' },
          { href: '/orari', label: 'Orari' },
          { href: '/wallet', label: 'Wallet' },
          { href: '/addebiti', label: 'Addebiti' },
          { href: '/fatturazione', label: 'Fatture' },
          { href: '/affiliazione', label: 'Affiliazione' },
          { href: '/notifiche', label: 'Notifiche' },
          { href: '/profilo', label: 'Profilo' },
        ]
      : [
          { href: '/dashboard', label: 'Dashboard' },
          { href: '/pratiche', label: 'Pratiche' },
          { href: '/wallet', label: 'Wallet' },
          { href: '/fatturazione', label: 'Fatture' },
          { href: '/affiliazione', label: 'Affiliazione' },
          { href: '/notifiche', label: 'Notifiche' },
          { href: '/profilo', label: 'Profilo' },
        ];
  if (role === 'ADMIN_AZIENDA') {
    links.push({ href: '/team', label: 'Team' });
  }
  return links;
}

function roleBadgeLabel(role: string | undefined, companyType: string | undefined): string {
  if (role === 'ADMIN_PIATTAFORMA') return 'Admin';
  if (companyType === 'DEALER') return 'Dealer';
  if (companyType === 'AGENZIA') return 'Agenzia';
  return 'Utente';
}

function initials(name?: string | null): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  return (parts[0]![0]! + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function AppShell({
  session,
  activePath,
  children,
}: {
  session: AppShellSession;
  activePath?: string;
  children: ReactNode;
}) {
  // Lo staff di piattaforma (admin + assistenti) usa la chrome CRM con sidebar
  // a colonna. Dealer e agenzie mantengono la top-bar storica invariata.
  if (session.user.role === 'ADMIN_PIATTAFORMA' || session.user.role === 'ASSISTENTE') {
    const buildSha = (process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7);
    return (
      <AdminShell
        session={session}
        activePath={activePath}
        buildSha={buildSha}
        demoBanner={<DemoBanner isAdmin={session.user.role === 'ADMIN_PIATTAFORMA'} />}
      >
        {children}
      </AdminShell>
    );
  }

  const links = navForRole(session.user.role, session.user.companyType);

  return (
    <div className="flex min-h-screen flex-col bg-pv-slate-50">
      <div className="sticky top-0 z-30">
        <DemoBanner isAdmin={session.user.role === 'ADMIN_PIATTAFORMA'} />
        <header className="bg-pv-navy-800 text-white shadow-[0_2px_12px_rgb(10_37_64_/_0.25)]">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5 sm:px-6">
          <Link href="/dashboard" className="flex items-center">
            <Image
              src="/brand/logo-dark.svg"
              alt="Passaggio Veloce"
              width={190}
              height={32}
              className="h-8 w-auto"
              priority
            />
          </Link>
          <UserMenu session={session} />
        </div>
        <nav className="mx-auto w-full max-w-6xl px-5 sm:px-6">
          <ul className="-mb-px flex gap-1 overflow-x-auto text-[13px]">
            {links.map((l) => {
              const isActive = activePath === l.href || activePath?.startsWith(l.href + '/');
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className={cn(
                      'inline-block whitespace-nowrap px-3.5 py-2.5 font-semibold transition-colors',
                      isActive
                        ? 'border-b-2 border-pv-orange-500 text-white'
                        : 'border-b-2 border-transparent text-[#b8cdea] hover:text-white',
                    )}
                  >
                    {l.label}
                    {l.href === '/inbox' && <NavBadge />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      </div>

      <main className="flex-1">
        <ToastProvider>{children}</ToastProvider>
      </main>

      <footer className="border-t border-pv-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-3 px-5 py-4 text-[12px] text-pv-slate-500 sm:flex-row sm:items-center sm:px-6">
          <p>
            © {new Date().getFullYear()} Passaggio Veloce ·{' '}
            <span className="text-pv-slate-700 font-semibold">{roleBadgeLabel(session.user.role, session.user.companyType)}</span>
          </p>
          <nav className="flex flex-wrap items-center gap-2 text-[11px]">
            <Link href="/privacy" className="hover:text-pv-navy-900">Privacy</Link>
            <Link href="/cookie" className="hover:text-pv-navy-900">Cookie</Link>
            <Link href="/termini" className="hover:text-pv-navy-900">Termini</Link>
            <span className="text-pv-slate-300">·</span>
            <span className="font-mono text-pv-slate-400">build {(process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7)}</span>
            <span className="text-pv-slate-300">·</span>
            <span>{session.user.email}</span>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function UserMenu({ session }: { session: AppShellSession }) {
  const name = session.user.name ?? session.user.email ?? 'Utente';
  const companyName = session.user.companyName?.trim() || null;
  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <p className="text-[13px] font-semibold leading-tight text-white">{name}</p>
        <div className="mt-1 flex items-center justify-end gap-1.5 leading-none">
          {companyName && (
            <span
              className="max-w-[170px] truncate text-[11px] font-medium text-[#cfe0f6]"
              title={companyName}
            >
              {companyName}
            </span>
          )}
          <span className="inline-flex items-center rounded-full bg-white/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-[#b8cdea] ring-1 ring-inset ring-white/15">
            {roleBadgeLabel(session.user.role, session.user.companyType)}
          </span>
        </div>
      </div>
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-pv-navy-700 text-[12px] font-bold text-white ring-2 ring-white/20">
        {initials(name)}
      </div>
      <form action={logoutAction}>
        <button
          type="submit"
          className="rounded-[10px] border border-[1.5px] border-white/20 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:shadow-[var(--pv-ring-focus)]"
        >
          Esci
        </button>
      </form>
    </div>
  );
}
