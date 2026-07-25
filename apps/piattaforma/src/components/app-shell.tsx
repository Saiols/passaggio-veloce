import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn, ToastProvider } from '@/components/ui';
import { NavBadge } from '@/components/nav-badge';
import { LogoutButton } from '@/components/logout-button';
import { DemoBanner } from '@/components/demo-banner';
import { SuspensionBanner } from '@/components/suspension-banner';
import { AdminShell } from '@/components/admin/admin-shell';
import { AgenziaShell } from '@/components/agenzia/agenzia-shell';
import { BrokerShell } from '@/components/broker/broker-shell';
import { EventoPraticaWatcher } from '@/components/eventi/evento-pratica-watcher';
import { SedeSwitcher } from '@/components/sede/sede-switcher';
import { getManageableSedi, getSessionContext } from '@/lib/auth/session-context';
import { etichettaRuolo } from '@/lib/auth/permessi/ruoli';
import { etichettaSede } from '@/lib/sedi/etichetta-sede';
import { resolveSedeRole } from '@/lib/sedi/scope';

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

function navForRole(
  role: string | undefined,
  companyType: string | undefined,
  canManageTeam: boolean,
): NavLink[] {
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
      adminLinks.push({ href: '/admin/segnalazioni-creazione', label: 'Problemi creazione' });
      adminLinks.push({ href: '/admin/affiliazioni', label: 'Affiliazioni' });
      adminLinks.push({ href: '/admin/codici-promozionali', label: 'Promo' });
      adminLinks.push({ href: '/admin/ateco', label: 'ATECO' });
      adminLinks.push({ href: '/admin/assistenti', label: 'Assistenti' });
      adminLinks.push({ href: '/admin/audit-log', label: 'Audit log' });
      adminLinks.push({ href: '/admin/tariffe', label: 'Tariffe' });
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
  if (canManageTeam) {
    links.push({ href: '/team', label: 'Team' });
  }
  return links;
}

/**
 * Il banner della sospensione dentro la chrome, con il proprio contenitore:
 * `{banners}` è renderizzato a tutta larghezza fra header e `<main>`, mentre
 * l'Alert vuole le stesse gutter del contenuto di pagina.
 *
 * `empty:hidden` toglie il contenitore — e con esso il padding — quando
 * `SuspensionBanner` si auto-annulla, cioè nella quasi totalità delle richieste:
 * senza, ogni pagina della piattaforma guadagnerebbe un gap fantasma in cima.
 */
function SuspensionBannerChrome() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 pt-6 empty:hidden sm:px-6">
      <SuspensionBanner />
    </div>
  );
}

/**
 * Banner globali della chrome, montati UNA volta per tutte le pagine che passano
 * da AppShell (57 su 78). Prima la sospensione era montata pagina per pagina,
 * sulla premessa — falsa — che non esistesse un posto unico: `DemoBanner` era già
 * qui, nello stesso ruolo. Il costo di quella scelta era che le pagine dove
 * un'agenzia lavora davvero (`/pratiche/[id]`, `/inbox/[id]`, `/team`,
 * `/addebiti`, `/profilo/*`, …) non dicevano nulla.
 *
 * ATTENZIONE: le 21 pagine che NON passano da AppShell restano scoperte. Le due
 * raggiungibili da un utente azienda con sessione — `/blocco-pagamento` e
 * `/visura`, due interstiziali senza chrome — montano il banner da sé. Le altre
 * 19 sono pre-sessione, admin (fuori scope) o pubbliche.
 */
function ChromeBanners({ isAdmin }: { isAdmin: boolean }) {
  return (
    <>
      <DemoBanner isAdmin={isAdmin} />
      <SuspensionBannerChrome />
    </>
  );
}

function initials(name?: string | null): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  return (parts[0]![0]! + (parts[1]?.[0] ?? '')).toUpperCase();
}

export async function AppShell({
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
        banners={<ChromeBanners isAdmin={session.user.role === 'ADMIN_PIATTAFORMA'} />}
      >
        {children}
      </AdminShell>
    );
  }

  // "Team" nav appare per chi gestisce almeno una sede (proprietario o admin di
  // sede). Calcolato una volta qui e propagato a broker/agenzia (client shell) e
  // al fallback top-bar. NOTA: getManageableSedi() → getSessionContext() aggiunge
  // un round-trip DB a ogni render di pagina company; accettabile per la scala.
  const puoGestireTeam = (await getManageableSedi()).length > 0;

  // isOwner e permessi vengono dal contesto sessione (già cache()-ato: la
  // chiamata sopra a getManageableSedi() lo invoca già, questa dedupe).
  // `permessi` attraversa il boundary server→client come array, non come Set.
  const ctx = await getSessionContext();
  const isOwner = ctx?.isOwner ?? false;
  const permessi = ctx ? [...ctx.permessi] : [];

  // Ruolo e sede della card utente. Il ruolo SEGUE la sede corrente: per i
  // non-owner `User.role` è sempre UTENTE_AZIENDA e non distingue un admin di
  // sede da un operatore — la distinzione sta nella membership della sede.
  // In vista aggregata non c'è una sede corrente, quindi nessun ruolo di
  // membership: `sedeRole` resta null e `etichettaRuolo` tiene il Titolare.
  const currentSede = ctx?.currentSede ?? null;
  const sedeRole =
    ctx && currentSede?.kind === 'ONE'
      ? resolveSedeRole({
          isOwner: ctx.isOwner,
          accessibleSedi: ctx.accessibleSedi,
          membershipRuoli: ctx.membershipRuoli,
          sedeId: currentSede.sede.id,
        })
      : null;
  const ruoloLabel = etichettaRuolo({ role: session.user.role, sedeRole });
  const sedeLabel = etichettaSede({
    currentSede,
    accessibleSedi: ctx?.accessibleSedi ?? [],
    ragioneSociale: session.user.companyName,
  });

  // Le agenzie usano la stessa chrome a sidebar (troppe voci per la top-bar).
  if (session.user.companyType === 'AGENZIA') {
    const buildSha = (process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7);
    return (
      <AgenziaShell
        session={session}
        activePath={activePath}
        buildSha={buildSha}
        isOwner={isOwner}
        permessi={permessi}
        puoGestireTeam={puoGestireTeam}
        ruoloLabel={ruoloLabel}
        sedeLabel={sedeLabel}
        banners={<ChromeBanners isAdmin={false} />}
      >
        <SedeSwitcher activePath={activePath} ragioneSociale={session.user.companyName} />
        {children}
      </AgenziaShell>
    );
  }

  // Anche i broker (dealer) usano la chrome a sidebar: backoffice uniforme per
  // tutti e tre i ruoli (admin / agenzia / broker).
  if (session.user.companyType === 'DEALER') {
    const buildSha = (process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7);
    return (
      <BrokerShell
        session={session}
        activePath={activePath}
        buildSha={buildSha}
        isOwner={isOwner}
        permessi={permessi}
        puoGestireTeam={puoGestireTeam}
        ruoloLabel={ruoloLabel}
        sedeLabel={sedeLabel}
        banners={<ChromeBanners isAdmin={false} />}
      >
        <SedeSwitcher activePath={activePath} ragioneSociale={session.user.companyName} />
        {children}
      </BrokerShell>
    );
  }

  // Fallback (utente senza companyType riconosciuto): top-bar storica.
  const links = navForRole(session.user.role, session.user.companyType, puoGestireTeam);

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

      {/* Fuori dal contenitore sticky: il banner della sospensione si legge una
          volta, non deve restare incollato in cima allo scroll come la top-bar. */}
      <SuspensionBannerChrome />

      <main className="flex-1">
        <ToastProvider>
          <EventoPraticaWatcher />
          {children}
        </ToastProvider>
      </main>

      <footer className="border-t border-pv-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-3 px-5 py-4 text-[12px] text-pv-slate-500 sm:flex-row sm:items-center sm:px-6">
          <p>
            © {new Date().getFullYear()} Passaggio Veloce ·{' '}
            <span className="text-pv-slate-700 font-semibold">{etichettaRuolo({ role: session.user.role, sedeRole: null })}</span>
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
            {etichettaRuolo({ role: session.user.role, sedeRole: null })}
          </span>
        </div>
      </div>
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-pv-navy-700 text-[12px] font-bold text-white ring-2 ring-white/20">
        {initials(name)}
      </div>
      <LogoutButton className="rounded-[10px] border border-[1.5px] border-white/20 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:shadow-[var(--pv-ring-focus)]">
        Esci
      </LogoutButton>
    </div>
  );
}
