'use client';

import { type ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import { NavBadge } from '@/components/nav-badge';
import { EventoPraticaWatcher } from '@/components/eventi/evento-pratica-watcher';
import { filtraGruppi } from '@/components/permessi/nav-filter';
import { SidebarShell, type SidebarNavGroup, type SidebarNavItem } from '@/components/sidebar-shell';
import type { Permesso } from '@/lib/auth/permessi/catalogo';
import {
  IconAffiliazioni,
  IconAgenzie,
  IconDashboard,
  IconFattura,
  IconNotifiche,
  IconPratiche,
  IconProfilo,
  IconUtenti,
  IconWallet,
} from '@/components/admin/admin-icons';

/**
 * Chrome dell'area broker (dealer): stessa sidebar a colonna di admin e agenzia
 * (SidebarShell), con le voci raggruppate per sezione logica. Sostituisce la
 * vecchia top-bar a scorrimento per uniformare il backoffice ai tre ruoli.
 */

/**
 * Annotazione esplicita richiesta da `filtraGruppi<T>`: senza, tsc non riesce a
 * unificare un `T` unico su un array con voci eterogenee (gruppi diversi hanno
 * voci con `permesso` diversi o assenti) — vedi nav-filter.test.ts per lo
 * stesso limite d'inferenza isolato.
 */
type BrokerNavItem = SidebarNavItem & { permesso?: Permesso };

type BrokerShellSession = {
  user: {
    name?: string | null;
    email?: string | null;
    role?: string;
    companyType?: string;
    companyName?: string | null;
  };
};

export function BrokerShell({
  session,
  activePath,
  buildSha,
  isOwner = false,
  permessi = [],
  puoGestireTeam = false,
  demoBanner,
  children,
}: {
  session: BrokerShellSession;
  activePath?: string;
  buildSha?: string;
  isOwner?: boolean;
  permessi?: Permesso[];
  puoGestireTeam?: boolean;
  demoBanner?: ReactNode;
  children: ReactNode;
}) {
  // Ogni voce dichiara il permesso che la rende visibile; `filtraGruppi` scarta
  // le voci negate e i gruppi rimasti senza voci. Dashboard e Profilo non hanno
  // permesso: ce li hanno tutti.
  const groups: SidebarNavGroup[] = filtraGruppi<BrokerNavItem>(
    [
      {
        label: 'Panoramica',
        items: [{ href: '/dashboard', label: 'Dashboard', icon: IconDashboard }],
      },
      {
        label: 'Operatività',
        items: [
          {
            href: '/pratiche',
            label: 'Pratiche',
            icon: IconPratiche,
            badge: <NavBadge keyName="praticheAttive" />,
            permesso: 'pratiche.view' as const,
          },
        ],
      },
      {
        label: 'Finanze',
        items: [
          { href: '/wallet', label: 'Wallet', icon: IconWallet, permesso: 'wallet.view' as const },
          {
            href: '/fatturazione',
            label: 'Fatture',
            icon: IconFattura,
            permesso: 'fatture.view' as const,
          },
        ],
      },
      {
        label: 'Crescita',
        items: [
          {
            href: '/affiliazione',
            label: 'Affiliazione',
            icon: IconAffiliazioni,
            permesso: 'affiliazione.view' as const,
          },
        ],
      },
      {
        label: 'Impostazioni',
        items: [
          {
            href: '/notifiche',
            label: 'Notifiche',
            icon: IconNotifiche,
            permesso: 'notifiche.view' as const,
          },
          { href: '/profilo', label: 'Profilo', icon: IconProfilo },
          // Sedi: owner-only e non delegabile, quindi non è un permesso del catalogo.
          ...(isOwner ? [{ href: '/sedi', label: 'Sedi', icon: IconAgenzie }] : []),
          ...(!isOwner
            ? [
                {
                  href: '/impostazioni-sede',
                  label: 'Impostazioni sede',
                  icon: IconAgenzie,
                  permesso: 'sede.view' as const,
                },
              ]
            : []),
          // Team: serve il permesso E una sede gestibile. `manageableSedi()` filtra sul
          // ruolo di sede, quindi per un OPERATORE è vuoto: mostrargli la voce
          // significherebbe rimbalzarlo alla dashboard al primo click.
          ...(puoGestireTeam
            ? [{ href: '/team', label: 'Team', icon: IconUtenti, permesso: 'team.view' as const }]
            : []),
        ],
      },
    ],
    { isOwner, permessi },
  );

  const name = session.user.name ?? session.user.email ?? 'Utente';
  const companyName = session.user.companyName?.trim();

  return (
    <SidebarShell
      groups={groups}
      userName={name}
      userEmail={session.user.email}
      roleLabel={companyName || 'Broker'}
      activePath={activePath}
      buildSha={buildSha}
      scrollKey="pv-broker-sidebar-scroll"
      demoBanner={demoBanner}
    >
      <ToastProvider>
        <EventoPraticaWatcher />
        {children}
      </ToastProvider>
    </SidebarShell>
  );
}
