'use client';

import { type ComponentType, type ReactNode } from 'react';
import { SidebarShell, type SidebarNavGroup } from '@/components/sidebar-shell';
import { NavBadge } from '@/components/nav-badge';
import { etichettaRuolo } from '@/lib/auth/permessi/ruoli';
import {
  IconAffiliazioni,
  IconAgenzie,
  IconAteco,
  IconAssistenti,
  IconAudit,
  IconBroker,
  IconChatbot,
  IconContatti,
  IconCrm,
  IconDashboard,
  IconEscalation,
  IconFinance,
  // IconListini, // LISTINI DISABILITATI (feature nascosta 2026-06-12)
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
 * Chrome dell'area admin: sidebar a colonna (via SidebarShell).
 * Qui vivono solo le voci e i permessi (ADMIN_PIATTAFORMA vs ASSISTENTE);
 * la chrome grafica è condivisa con l'area agenzia.
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
  /** Badge opzionale accanto alla label (conteggio da /api/badges). */
  badge?: ReactNode;
};

type NavGroup = { label: string; items: NavItem[] };

// Raggruppamento "da CRM" delle voci che prima vivevano nei tab a scorrimento.
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
      {
        href: '/admin/segnalazioni',
        label: 'Segnalazioni',
        icon: IconSegnalazioni,
        adminOnly: true,
        badge: <NavBadge keyName="segnalazioni" />,
      },
      {
        href: '/admin/segnalazioni-creazione',
        label: 'Problemi creazione',
        icon: IconRevisioni,
        adminOnly: true,
        badge: <NavBadge keyName="segnalazioniCreazione" />,
      },
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
      { href: '/admin/crm/dashboard', label: 'Dashboard', icon: IconDashboard },
      { href: '/admin/crm/contatti', label: 'Contatti', icon: IconCrm },
      { href: '/admin/crm/contatti-operativi', label: 'Acquirenti/venditori', icon: IconContatti },
      { href: '/admin/crm/sales', label: 'Sales', icon: IconSales },
      { href: '/admin/crm/chatbot', label: 'Chatbot', icon: IconChatbot },
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
      { href: '/admin/tariffe', label: 'Tariffe', icon: IconFinance, adminOnly: true },
      // LISTINI DISABILITATI (feature nascosta 2026-06-12) — riattivare con /admin/listini:
      // { href: '/admin/listini', label: 'Listini', icon: IconListini, adminOnly: true },
      { href: '/admin/audit-log', label: 'Audit log', icon: IconAudit, adminOnly: true },
    ],
  },
];

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
  const isFullAdmin = session.user.role === 'ADMIN_PIATTAFORMA';
  const groups: SidebarNavGroup[] = NAV_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter((i) => isFullAdmin || !i.adminOnly),
  })).filter((g) => g.items.length > 0);

  const name = session.user.name ?? session.user.email ?? 'Utente';

  return (
    <SidebarShell
      groups={groups}
      userName={name}
      userEmail={session.user.email}
      companyLabel={null}
      ruoloLabel={etichettaRuolo({ role: session.user.role, sedeRole: null })}
      sedeLabel={null}
      activePath={activePath}
      buildSha={buildSha}
      scrollKey="pv-admin-sidebar-scroll"
      demoBanner={demoBanner}
    >
      {children}
    </SidebarShell>
  );
}
