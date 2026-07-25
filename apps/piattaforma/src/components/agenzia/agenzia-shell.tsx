'use client';

import { type ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import { NavBadge } from '@/components/nav-badge';
import { EventoPraticaWatcher } from '@/components/eventi/evento-pratica-watcher';
import { AffiliazioneSpot } from '@/components/affiliazione/affiliazione-spot';
import { gruppiAgenzia } from '@/components/permessi/nav-voci';
import { iconaComponente } from '@/components/permessi/nav-icone';
import { SidebarShell, type SidebarNavGroup } from '@/components/sidebar-shell';
import type { Permesso } from '@/lib/auth/permessi/catalogo';

/**
 * Chrome dell'area agenzia: stessa sidebar a colonna dell'admin (SidebarShell),
 * con le voci raggruppate per sezione logica. Sostituisce la vecchia top-bar a
 * scorrimento, diventata inutilizzabile con troppe voci.
 *
 * La costruzione dei gruppi (chi vede cosa, incluso il gate a doppia
 * condizione di Team) vive in `nav-voci.ts` (modulo puro, condiviso con
 * BrokerShell): qui ci si limita a risolvere le chiavi icona in componenti
 * React e ad attaccare i badge in base all'href.
 */

type AgenziaShellSession = {
  user: {
    name?: string | null;
    email?: string | null;
    role?: string;
    companyType?: string;
    companyName?: string | null;
  };
};

function badgePerHref(href: string): ReactNode | undefined {
  if (href === '/pratiche') return <NavBadge keyName="praticheAttive" />;
  if (href === '/inbox') return <NavBadge />;
  return undefined;
}

export function AgenziaShell({
  session,
  activePath,
  buildSha,
  isOwner = false,
  permessi = [],
  puoGestireTeam = false,
  soloLettura,
  ruoloLabel,
  sedeLabel,
  banners,
  children,
}: {
  session: AgenziaShellSession;
  activePath?: string;
  buildSha?: string;
  isOwner?: boolean;
  permessi?: Permesso[];
  puoGestireTeam?: boolean;
  /**
   * Account sospeso. Senza default, a differenza di `isOwner`/`permessi`: un
   * default `false` qui sarebbe fail-OPEN (nav più permissiva del dovuto),
   * mentre dimenticare gli altri due mostra semplicemente meno voci.
   */
  soloLettura: boolean;
  ruoloLabel: string;
  sedeLabel: string | null;
  banners?: ReactNode;
  children: ReactNode;
}) {
  const groups: SidebarNavGroup[] = gruppiAgenzia({
    isOwner,
    permessi,
    puoGestireTeam,
    soloLettura,
  }).map((g) => ({
    label: g.label,
    items: g.items.map((item) => ({
      href: item.href,
      label: item.label,
      icon: iconaComponente(item.icona),
      badge: badgePerHref(item.href),
    })),
  }));

  const name = session.user.name ?? session.user.email ?? 'Utente';
  const companyName = session.user.companyName?.trim();

  return (
    <SidebarShell
      groups={groups}
      userName={name}
      userEmail={session.user.email}
      companyLabel={companyName || 'Agenzia'}
      ruoloLabel={ruoloLabel}
      sedeLabel={sedeLabel}
      activePath={activePath}
      buildSha={buildSha}
      scrollKey="pv-agenzia-sidebar-scroll"
      banners={banners}
    >
      <ToastProvider>
        <EventoPraticaWatcher />
        <AffiliazioneSpot />
        {children}
      </ToastProvider>
    </SidebarShell>
  );
}
