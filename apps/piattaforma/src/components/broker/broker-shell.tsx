'use client';

import { type ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import { EventoPraticaWatcher } from '@/components/eventi/evento-pratica-watcher';
import { SidebarShell, type SidebarNavGroup } from '@/components/sidebar-shell';
import {
  IconAffiliazioni,
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
  demoBanner,
  children,
}: {
  session: BrokerShellSession;
  activePath?: string;
  buildSha?: string;
  demoBanner?: ReactNode;
  children: ReactNode;
}) {
  const isAdminAzienda = session.user.role === 'ADMIN_AZIENDA';

  const groups: SidebarNavGroup[] = [
    {
      label: 'Panoramica',
      items: [{ href: '/dashboard', label: 'Dashboard', icon: IconDashboard }],
    },
    {
      label: 'Operatività',
      items: [{ href: '/pratiche', label: 'Pratiche', icon: IconPratiche }],
    },
    {
      label: 'Finanze',
      items: [
        { href: '/wallet', label: 'Wallet', icon: IconWallet },
        { href: '/fatturazione', label: 'Fatture', icon: IconFattura },
      ],
    },
    {
      label: 'Crescita',
      items: [{ href: '/affiliazione', label: 'Affiliazione', icon: IconAffiliazioni }],
    },
    {
      label: 'Impostazioni',
      items: [
        { href: '/notifiche', label: 'Notifiche', icon: IconNotifiche },
        { href: '/profilo', label: 'Profilo', icon: IconProfilo },
        ...(isAdminAzienda
          ? [{ href: '/team', label: 'Team', icon: IconUtenti }]
          : []),
      ],
    },
  ];

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
