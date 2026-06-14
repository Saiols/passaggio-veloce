'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { cn } from '@/components/ui';
import { logoutAction } from '@/app/(auth)/actions';
import {
  IconAffiliazioni,
  IconAgenzie,
  IconAteco,
  IconAssistenti,
  IconAudit,
  IconBroker,
  IconChatbot,
  IconClose,
  IconCrm,
  IconDashboard,
  IconEscalation,
  IconFinance,
  // IconListini, // LISTINI DISABILITATI (feature nascosta 2026-06-12)
  IconLogout,
  IconMenu,
  IconPermessi,
  IconPratiche,
  IconPromo,
  IconRevisioni,
  IconSales,
  IconSegnalazioni,
  IconUtenti,
  type AdminIconProps,
} from './admin-icons';

/**
 * Chrome dell'area admin in stile CRM: sidebar a colonna a sinistra.
 *
 * - Desktop (lg+): sidebar fissa persistente, contenuto offsettato a destra.
 * - Tablet / mobile (<lg): sidebar off-canvas (drawer) con top-bar + hamburger.
 *
 * Solo refactor grafico: nessuna logica applicativa. Le voci e i permessi
 * (ADMIN_PIATTAFORMA vs ASSISTENTE) rispecchiano 1:1 navForRole in app-shell.
 */

type AdminShellSession = {
  user: {
    name?: string | null;
    email?: string | null;
    role?: string;
    companyType?: string;
  };
};

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<AdminIconProps>;
  /** Visibile solo ad ADMIN_PIATTAFORMA (non ad ASSISTENTE). */
  adminOnly?: boolean;
};

type NavGroup = { label: string; items: NavItem[] };

// Larghezza sidebar: tenuta in sync con `lg:pl-[17rem]` della colonna contenuto.

// Raggruppamento "da CRM" delle voci che prima vivevano nei tab a scorrimento.
// Set e permessi identici a navForRole() in app-shell.tsx.
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Panoramica',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: IconDashboard },
      { href: '/admin/dashboard', label: 'Finanze', icon: IconFinance, adminOnly: true },
      { href: '/admin/fatturazione', label: 'Fatture', icon: IconFinance, adminOnly: true },
    ],
  },
  {
    label: 'Operatività',
    items: [
      { href: '/admin/pratiche', label: 'Pratiche', icon: IconPratiche },
      { href: '/admin/escalation', label: 'Escalation', icon: IconEscalation },
      { href: '/admin/segnalazioni', label: 'Segnalazioni', icon: IconSegnalazioni, adminOnly: true },
      { href: '/admin/revisioni', label: 'Revisioni', icon: IconRevisioni, adminOnly: true },
    ],
  },
  {
    label: 'Anagrafiche',
    items: [
      { href: '/admin/broker', label: 'Broker', icon: IconBroker },
      { href: '/admin/agenzie', label: 'Agenzie', icon: IconAgenzie },
      { href: '/admin/utenti', label: 'Utenti', icon: IconUtenti },
    ],
  },
  {
    label: 'CRM',
    items: [
      { href: '/admin/crm/contatti', label: 'Contatti', icon: IconCrm },
      { href: '/admin/crm/sales', label: 'Sales', icon: IconSales },
      { href: '/admin/crm/chatbot', label: 'Chatbot', icon: IconChatbot },
      { href: '/admin/crm/dashboard', label: 'Dashboard', icon: IconDashboard },
      { href: '/admin/crm/utenti', label: 'Utenti team', icon: IconUtenti },
      { href: '/admin/crm/permessi', label: 'Permessi', icon: IconPermessi },
    ],
  },
  {
    label: 'Crescita',
    items: [
      { href: '/admin/affiliazioni', label: 'Affiliazioni', icon: IconAffiliazioni, adminOnly: true },
      { href: '/admin/codici-promozionali', label: 'Promo', icon: IconPromo, adminOnly: true },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { href: '/admin/ateco', label: 'ATECO', icon: IconAteco, adminOnly: true },
      { href: '/admin/assistenti', label: 'Assistenti', icon: IconAssistenti, adminOnly: true },
      // LISTINI DISABILITATI (feature nascosta 2026-06-12) — riattivare con /admin/listini:
      // { href: '/admin/listini', label: 'Listini', icon: IconListini, adminOnly: true },
      { href: '/admin/audit-log', label: 'Audit log', icon: IconAudit, adminOnly: true },
    ],
  },
];

// Chiave sessionStorage per conservare lo scroll della sidebar tra le rotte.
const SIDEBAR_SCROLL_KEY = 'pv-admin-sidebar-scroll';

// useLayoutEffect lato client (ripristina prima del paint → niente salto),
// useEffect lato server per evitare il warning SSR.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function isItemActive(activePath: string | undefined, pathname: string, href: string): boolean {
  // L'activePath fornito dalla pagina è la fonte primaria (gestisce i casi
  // dinamici tipo /admin/companies/[id] → /admin/broker). Fallback a pathname.
  const ref = activePath ?? pathname;
  if (!ref) return false;
  return ref === href || ref.startsWith(href + '/');
}

function initials(name?: string | null): string {
  if (!name) return 'PV';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'PV';
}

function roleLabel(role: string | undefined): string {
  if (role === 'ADMIN_PIATTAFORMA') return 'Admin piattaforma';
  if (role === 'ASSISTENTE') return 'Assistente';
  return 'Staff';
}

export function AdminShell({
  session,
  activePath,
  buildSha,
  demoBanner,
  children,
}: {
  session: AdminShellSession;
  activePath?: string;
  buildSha?: string;
  demoBanner?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isFullAdmin = session.user.role === 'ADMIN_PIATTAFORMA';
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => isFullAdmin || !i.adminOnly),
  })).filter((g) => g.items.length > 0);

  const closeDrawer = () => setOpen(false);

  // Conserva la posizione di scroll della sidebar tra una navigazione e l'altra.
  // La chrome admin è renderizzata dentro ogni page.tsx (non in un layout
  // persistente), quindi rimonta a ogni cambio rotta e la nav ripartirebbe da
  // cima. Salviamo lo scrollTop su ogni scroll e lo ripristiniamo al mount,
  // prima del paint, così non si vede alcun salto.
  const navRef = useRef<HTMLElement>(null);
  useIsoLayoutEffect(() => {
    const el = navRef.current;
    if (!el) return;
    try {
      const saved = sessionStorage.getItem(SIDEBAR_SCROLL_KEY);
      if (saved) el.scrollTop = parseInt(saved, 10) || 0;
    } catch {
      /* sessionStorage non disponibile: ignora */
    }
  }, []);

  // Esc per chiudere + lock dello scroll del body quando il drawer è aperto.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const name = session.user.name ?? session.user.email ?? 'Utente';

  return (
    <div className="min-h-screen bg-pv-slate-50">
      {/* Overlay drawer (solo <lg) */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden="true"
        className={cn(
          'fixed inset-0 z-40 bg-pv-navy-900/60 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      {/* Sidebar — fissa su desktop, drawer su mobile/tablet */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col',
          'bg-gradient-to-b from-pv-navy-900 to-pv-navy-800 text-white',
          'border-r border-white/5 shadow-[0_0_40px_rgba(10,15,31,0.45)]',
          'transition-transform duration-300 ease-out lg:shadow-none',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        {/* Logo + close */}
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-5">
          <Link href="/dashboard" onClick={closeDrawer} className="flex items-center">
            <Image
              src="/brand/logo-dark.svg"
              alt="Passaggio Veloce"
              width={190}
              height={32}
              className="h-7 w-auto"
              priority
            />
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Chiudi menù"
            className="-mr-2 rounded-[10px] p-2 text-[#b8cdea] transition-colors hover:bg-white/10 hover:text-white lg:hidden"
          >
            <IconClose className="h-5 w-5" />
          </button>
        </div>

        <div className="mx-5 h-px shrink-0 bg-white/10" />

        {/* Navigazione raggruppata */}
        <nav
          ref={navRef}
          onScroll={(e) => {
            try {
              sessionStorage.setItem(SIDEBAR_SCROLL_KEY, String(e.currentTarget.scrollTop));
            } catch {
              /* sessionStorage non disponibile: ignora */
            }
          }}
          className="pv-sidebar-scroll flex-1 overflow-y-auto px-3 py-4"
        >
          {groups.map((group) => (
            <div key={group.label} className="mb-5 last:mb-0">
              <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#6f8cb5]">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isItemActive(activePath, pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={closeDrawer}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'group relative flex items-center gap-3 rounded-[10px] px-3 py-2 text-[13.5px] font-semibold transition-colors',
                          active
                            ? 'bg-white/[0.08] text-white'
                            : 'text-[#b8cdea] hover:bg-white/[0.05] hover:text-white',
                        )}
                      >
                        {active && (
                          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-pv-orange-500" />
                        )}
                        <Icon
                          className={cn(
                            'h-[18px] w-[18px] shrink-0 transition-colors',
                            active ? 'text-pv-orange-500' : 'text-[#7f9bc4] group-hover:text-white',
                          )}
                        />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Card utente + logout */}
        <div className="shrink-0 border-t border-white/10 p-3">
          <div className="flex items-center gap-3 rounded-[12px] bg-white/[0.06] p-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pv-navy-600 text-[12px] font-bold text-white ring-2 ring-white/15">
              {initials(name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold leading-tight text-white">{name}</p>
              <p className="truncate text-[11px] text-[#8aa6cd]">{roleLabel(session.user.role)}</p>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                aria-label="Esci"
                title="Esci"
                className="rounded-[9px] p-2 text-[#b8cdea] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:shadow-[var(--pv-ring-focus)]"
              >
                <IconLogout className="h-[18px] w-[18px]" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Colonna contenuto */}
      <div className="flex min-h-screen flex-col lg:pl-[17rem]">
        {/* Top-bar mobile/tablet */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-pv-slate-200 bg-white/90 px-4 backdrop-blur-md lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Apri menù"
            aria-expanded={open}
            className="-ml-1 rounded-[10px] p-2 text-pv-navy-800 transition-colors hover:bg-pv-slate-100"
          >
            <IconMenu className="h-6 w-6" />
          </button>
          <Link href="/dashboard" className="flex items-center">
            <Image
              src="/brand/logo-primary.svg"
              alt="Passaggio Veloce"
              width={190}
              height={32}
              className="h-6 w-auto"
            />
          </Link>
          <div className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-pv-navy-700 text-[11px] font-bold text-white">
            {initials(name)}
          </div>
        </header>

        {demoBanner}

        <main className="flex-1">{children}</main>

        <footer className="border-t border-pv-slate-200 bg-white">
          <div className="flex flex-col items-start justify-between gap-2 px-5 py-3 text-[11px] text-pv-slate-500 sm:flex-row sm:items-center sm:px-6">
            <p>
              © {new Date().getFullYear()} Passaggio Veloce ·{' '}
              <span className="font-semibold text-pv-slate-700">{roleLabel(session.user.role)}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/privacy" className="hover:text-pv-navy-900">
                Privacy
              </Link>
              <Link href="/cookie" className="hover:text-pv-navy-900">
                Cookie
              </Link>
              <Link href="/termini" className="hover:text-pv-navy-900">
                Termini
              </Link>
              <span className="text-pv-slate-300">·</span>
              <span className="font-mono text-pv-slate-400">build {buildSha ?? 'dev'}</span>
              <span className="text-pv-slate-300">·</span>
              <span className="truncate">{session.user.email}</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
