import Link from 'next/link';

/**
 * Tab navigator dell'hub /admin/crm.
 *
 * - Tab top "contatti": Pipeline lead vs Catalogo operativo (sub-tabs sotto).
 * - Tab "sales", "chatbot", "dashboard": placeholder (CRM-C, D, E in arrivo).
 * - Tab "utenti", "permessi": gestione team interno + matrice (CRM-F).
 *
 * Spec: docs/crm-spec-implementativa.md §1, §3, §5.
 */
export type CrmTabKey =
  | 'pipeline'
  | 'operativi'
  | 'sales'
  | 'chatbot'
  | 'dashboard'
  | 'utenti'
  | 'permessi';

const TOP_TABS: {
  key: 'contatti' | 'sales' | 'chatbot' | 'dashboard' | 'utenti' | 'permessi';
  label: string;
  hint: string;
  href: string;
  enabled: boolean;
  matches: CrmTabKey[];
}[] = [
  {
    key: 'contatti',
    label: 'Contatti',
    hint: 'Pipeline lead + catalogo operativo',
    href: '/admin/crm/contatti',
    enabled: true,
    matches: ['pipeline', 'operativi'],
  },
  {
    key: 'sales',
    label: 'Sales',
    hint: 'Agent vocali + campagne',
    href: '/admin/crm/sales',
    enabled: true,
    matches: ['sales'],
  },
  {
    key: 'chatbot',
    label: 'Chatbot',
    hint: 'Bot testuali sito/WhatsApp/mail',
    href: '/admin/crm/chatbot',
    enabled: true,
    matches: ['chatbot'],
  },
  {
    key: 'dashboard',
    label: 'Dashboard',
    hint: 'KPI funnel + dati economici',
    href: '/admin/crm/dashboard',
    enabled: true,
    matches: ['dashboard'],
  },
  {
    key: 'utenti',
    label: 'Utenti team',
    hint: 'Gestione team interno PV',
    href: '/admin/crm/utenti',
    enabled: true,
    matches: ['utenti'],
  },
  {
    key: 'permessi',
    label: 'Permessi',
    hint: 'Matrice readonly',
    href: '/admin/crm/permessi',
    enabled: true,
    matches: ['permessi'],
  },
];

export function CrmTabs({ active }: { active: CrmTabKey }) {
  const activeTop = TOP_TABS.find((t) => t.matches.includes(active));

  return (
    <>
      <nav
        role="tablist"
        className="mb-4 flex flex-wrap items-center gap-1 rounded-[12px] border border-pv-slate-200 bg-white p-1 shadow-[var(--pv-shadow-card)]"
      >
        {TOP_TABS.map((t) => {
          const isActive = activeTop?.key === t.key;
          if (!t.enabled) {
            return (
              <span
                key={t.key}
                className="flex flex-col rounded-[10px] px-3 py-2 text-pv-slate-300"
                title="In arrivo"
              >
                <span className="text-[12.5px] font-bold">{t.label}</span>
                <span className="text-[10.5px]">In arrivo</span>
              </span>
            );
          }
          return (
            <Link
              key={t.key}
              href={t.href}
              role="tab"
              aria-selected={isActive}
              className={
                'flex flex-col rounded-[10px] px-3 py-2 transition-colors ' +
                (isActive
                  ? 'bg-pv-navy-700 text-white'
                  : 'text-pv-slate-700 hover:bg-pv-slate-50')
              }
            >
              <span className="text-[12.5px] font-bold">{t.label}</span>
              <span
                className={
                  'text-[10.5px] ' +
                  (isActive ? 'text-white/70' : 'text-pv-slate-500')
                }
              >
                {t.hint}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Sub-tabs per Contatti */}
      {(active === 'pipeline' || active === 'operativi') && (
        <nav
          role="tablist"
          className="mb-6 flex items-center gap-1 rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 p-1"
        >
          <SubTab
            href="/admin/crm/contatti"
            label="Pipeline lead"
            hint="Pre-iscrizione · funnel S0 → S10"
            active={active === 'pipeline'}
          />
          <SubTab
            href="/admin/crm/contatti-operativi"
            label="Contatti operativi"
            hint="Catalogo dedupli­cato post-iscrizione"
            active={active === 'operativi'}
          />
        </nav>
      )}
    </>
  );
}

function SubTab({
  href,
  label,
  hint,
  active,
}: {
  href: string;
  label: string;
  hint: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={
        'flex flex-1 flex-col rounded-[8px] px-3 py-2 transition-colors ' +
        (active
          ? 'bg-white text-pv-navy-900 shadow-[var(--pv-shadow-card)]'
          : 'text-pv-slate-700 hover:bg-white')
      }
    >
      <span className="text-[12.5px] font-bold">{label}</span>
      <span className="text-[10.5px] text-pv-slate-500">{hint}</span>
    </Link>
  );
}
