'use client';

import { type ReactNode } from 'react';
import { ToastProvider } from '@/components/ui';
import { NavBadge } from '@/components/nav-badge';
import { EventoPraticaWatcher } from '@/components/eventi/evento-pratica-watcher';
import { SidebarShell, type SidebarNavGroup } from '@/components/sidebar-shell';
import {
  IconAddebiti,
  IconAffiliazioni,
  IconAgenzie,
  IconDashboard,
  IconFattura,
  IconFeedback,
  IconInbox,
  IconNotifiche,
  IconOrari,
  IconPratiche,
  IconProfilo,
  IconUtenti,
  IconWallet,
} from '@/components/admin/admin-icons';

/**
 * Chrome dell'area agenzia: stessa sidebar a colonna dell'admin (SidebarShell),
 * con le voci raggruppate per sezione logica. Sostituisce la vecchia top-bar a
 * scorrimento, diventata inutilizzabile con troppe voci.
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

export function AgenziaShell({
  session,
  activePath,
  buildSha,
  canManageTeam,
  demoBanner,
  children,
}: {
  session: AgenziaShellSession;
  activePath?: string;
  buildSha?: string;
  canManageTeam?: boolean;
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
      items: [
        { href: '/inbox', label: 'Inbox', icon: IconInbox, badge: <NavBadge /> },
        {
          href: '/pratiche',
          label: 'Pratiche attive',
          icon: IconPratiche,
          badge: <NavBadge keyName="praticheAttive" />,
        },
      ],
    },
    {
      label: 'Finanze',
      items: [
        { href: '/wallet', label: 'Wallet', icon: IconWallet },
        { href: '/addebiti', label: 'Addebiti', icon: IconAddebiti },
        { href: '/fatturazione', label: 'Fatture', icon: IconFattura },
      ],
    },
    {
      label: 'Crescita',
      items: [
        { href: '/affiliazione', label: 'Affiliazione', icon: IconAffiliazioni },
        { href: '/feedback', label: 'Feedback', icon: IconFeedback },
      ],
    },
    {
      label: 'Impostazioni',
      items: [
        { href: '/orari', label: 'Orari', icon: IconOrari },
        { href: '/notifiche', label: 'Notifiche', icon: IconNotifiche },
        { href: '/profilo', label: 'Profilo', icon: IconProfilo },
        ...(isAdminAzienda ? [{ href: '/sedi', label: 'Sedi', icon: IconAgenzie }] : []),
        ...(!isAdminAzienda && canManageTeam
          ? [{ href: '/impostazioni-sede', label: 'Impostazioni sede', icon: IconAgenzie }]
          : []),
        ...(isAdminAzienda || canManageTeam
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
      roleLabel={companyName || 'Agenzia'}
      activePath={activePath}
      buildSha={buildSha}
      scrollKey="pv-agenzia-sidebar-scroll"
      demoBanner={demoBanner}
    >
      <ToastProvider>
        <EventoPraticaWatcher />
        {children}
      </ToastProvider>
    </SidebarShell>
  );
}
