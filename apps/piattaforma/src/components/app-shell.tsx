import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/components/ui';
import { logoutAction } from '@/app/(auth)/actions';
import { DemoBanner } from '@/components/demo-banner';

export type AppShellSession = {
  user: {
    name?: string | null;
    email?: string | null;
    role?: string;
    companyType?: string;
  };
};

type NavLink = { href: string; label: string };

function navForRole(role: string | undefined, companyType: string | undefined): NavLink[] {
  if (role === 'ADMIN_PIATTAFORMA') {
    return [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/admin/pratiche', label: 'Pratiche' },
      { href: '/admin/agenzie', label: 'Agenzie' },
      { href: '/admin/utenti', label: 'Utenti' },
      { href: '/admin/escalation', label: 'Escalation' },
    ];
  }
  const links: NavLink[] =
    companyType === 'AGENZIA'
      ? [
          { href: '/dashboard', label: 'Dashboard' },
          { href: '/inbox', label: 'Inbox' },
          { href: '/pratiche', label: 'Pratiche attive' },
          { href: '/orari', label: 'Orari' },
          { href: '/notifiche', label: 'Notifiche' },
          { href: '/profilo', label: 'Profilo' },
        ]
      : [
          { href: '/dashboard', label: 'Dashboard' },
          { href: '/pratiche', label: 'Pratiche' },
          { href: '/wallet', label: 'Wallet' },
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
  const links = navForRole(session.user.role, session.user.companyType);

  return (
    <div className="flex min-h-screen flex-col bg-pv-slate-50">
      <div className="sticky top-0 z-30">
        <DemoBanner isAdmin={session.user.role === 'ADMIN_PIATTAFORMA'} />
        <header className="bg-pv-navy-800 text-white shadow-[0_2px_12px_rgb(10_37_64_/_0.25)]">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white">
              <Image src="/brand/logo.svg" alt="" width={18} height={18} className="h-[18px] w-[18px]" />
            </span>
            <span className="text-[14px] font-extrabold tracking-tight">Passaggio Veloce</span>
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
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      </div>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-pv-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 text-[12px] text-pv-slate-500 sm:px-6">
          <p>
            © {new Date().getFullYear()} Passaggio Veloce ·{' '}
            <span className="text-pv-slate-700 font-semibold">{roleBadgeLabel(session.user.role, session.user.companyType)}</span>
          </p>
          <p>{session.user.email}</p>
        </div>
      </footer>
    </div>
  );
}

function UserMenu({ session }: { session: AppShellSession }) {
  const name = session.user.name ?? session.user.email ?? 'Utente';
  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <p className="text-[13px] font-semibold leading-tight text-white">{name}</p>
        <p className="text-[11px] text-[#b8cdea]">
          {roleBadgeLabel(session.user.role, session.user.companyType)}
        </p>
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
