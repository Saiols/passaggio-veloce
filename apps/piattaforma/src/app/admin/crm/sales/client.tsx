'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, NumberInput } from '@/components/ui';
import {
  createSalesAgentAction,
  updateSalesAgentAction,
  deleteSalesAgentAction,
  createCampaignAction,
  updateCampaignAction,
  setCampaignStatusAction,
  deleteCampaignAction,
  type SalesAgentInput,
  type CampaignInput,
} from './actions';

type Agent = {
  id: string;
  nome: string;
  lingua: string;
  voce: string;
  accento: string;
  prompt: string;
  scriptPrimo: string;
  scriptFollowup: string;
  qa: string;
  postCall: string;
  vapiAgentId: string | null;
  campaignCount: number;
};

type Campaign = {
  id: string;
  nome: string;
  agentId: string;
  agentName: string;
  ownerId: string;
  ownerName: string;
  regione: string | null;
  cat: string | null;
  statoTarget: string | null;
  maxTry: number;
  intervalMin: number;
  oraStart: string;
  oraEnd: string;
  giorniAttivi: string;
  status: string;
  note: string | null;
  assegnatiCount: number;
  canManage: boolean;
};

const LINGUE = [
  ['ITALIANO', 'Italiano'],
  ['ENGLISH', 'English'],
  ['ESPANOL', 'Español'],
] as const;
const VOCI = [
  ['FEMMINILE_NATURALE', 'Femminile naturale'],
  ['MASCHILE_NATURALE', 'Maschile naturale'],
  ['CLONATA', 'Clonata'],
] as const;
const ACCENTI = [
  ['NEUTRO_ITALIANO', 'Neutro italiano'],
  ['NORD_ITALIA', 'Nord Italia'],
  ['CENTRO_ITALIA', 'Centro Italia'],
  ['SUD_ITALIA', 'Sud Italia'],
] as const;
const GIORNI = [
  ['LUN_VEN', 'Lunedì — Venerdì'],
  ['LUN_SAB', 'Lunedì — Sabato'],
  ['TUTTI', 'Tutti i giorni'],
] as const;
const STATI_TARGET: { v: string; l: string }[] = [
  { v: '', l: 'Tutti gli stati' },
  { v: 'S0', l: 'S0 — Non contattato' },
  { v: 'S1', l: 'S1 — Non risponde' },
  { v: 'S2', l: 'S2 — Non interessato' },
  { v: 'S3', l: 'S3 — Interessato' },
  { v: 'S4', l: 'S4 — Link non aperto' },
  { v: 'S5', l: 'S5 — Link aperto' },
];

export function CrmSalesClient({
  agents,
  campaigns,
  canManageAgent,
}: {
  agents: Agent[];
  campaigns: Campaign[];
  canManageAgent: boolean;
}) {
  const router = useRouter();
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Sales Agents */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-pv-navy-900">
            🤖 Sales Agent ({agents.length})
          </h2>
          {canManageAgent && (
            <Button size="sm" onClick={() => setCreatingAgent(true)}>
              + Nuovo agent
            </Button>
          )}
        </div>
        {agents.length === 0 ? (
          <div className="rounded-[12px] border border-pv-slate-200 bg-white px-4 py-12 text-center text-[13px] text-pv-slate-500">
            Nessun agent configurato.
          </div>
        ) : (
          <div className="space-y-3">
            {agents.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                canManage={canManageAgent}
                onEdit={() => setEditingAgent(a)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Campaigns */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-pv-navy-900">
            📣 Campagne ({campaigns.length})
          </h2>
          {agents.length > 0 && (
            <Button size="sm" onClick={() => setCreatingCampaign(true)}>
              + Nuova campagna
            </Button>
          )}
        </div>
        {agents.length === 0 ? (
          <div className="rounded-[12px] border border-pv-amber-500/30 bg-pv-amber-50/40 px-4 py-6 text-[13px] text-pv-slate-700">
            Per creare una campagna serve almeno un sales agent. Crealo nella
            colonna a fianco.
          </div>
        ) : campaigns.length === 0 ? (
          <div className="rounded-[12px] border border-pv-slate-200 bg-white px-4 py-12 text-center text-[13px] text-pv-slate-500">
            Nessuna campagna creata.
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                onEdit={() => setEditingCampaign(c)}
                onStatusChange={() => router.refresh()}
              />
            ))}
          </div>
        )}
      </div>

      {(creatingAgent || editingAgent) && (
        <AgentModal
          agent={editingAgent}
          onClose={() => {
            setCreatingAgent(false);
            setEditingAgent(null);
          }}
          onSaved={() => {
            setCreatingAgent(false);
            setEditingAgent(null);
            router.refresh();
          }}
        />
      )}
      {(creatingCampaign || editingCampaign) && (
        <CampaignModal
          campaign={editingCampaign}
          agents={agents}
          onClose={() => {
            setCreatingCampaign(false);
            setEditingCampaign(null);
          }}
          onSaved={() => {
            setCreatingCampaign(false);
            setEditingCampaign(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// Agent card
// ════════════════════════════════════════════════════════
function AgentCard({
  agent,
  canManage,
  onEdit,
}: {
  agent: Agent;
  canManage: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="rounded-[12px] border border-pv-slate-200 bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-pv-navy-900">
            🤖 {agent.nome}
          </p>
          <p className="text-[11.5px] text-pv-slate-500">
            {labelLingua(agent.lingua)} · {labelVoce(agent.voce)} ·{' '}
            {labelAccento(agent.accento)} · {agent.campaignCount} campagn
            {agent.campaignCount === 1 ? 'a' : 'e'}
          </p>
        </div>
        {canManage && (
          <Button variant="secondary" size="sm" onClick={onEdit}>
            Modifica
          </Button>
        )}
      </div>
      <p className="mt-2 line-clamp-2 rounded-[8px] bg-pv-slate-50 px-3 py-2 text-[12px] text-pv-slate-700">
        {agent.prompt.slice(0, 200)}
        {agent.prompt.length > 200 ? '…' : ''}
      </p>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// Campaign card
// ════════════════════════════════════════════════════════
function CampaignCard({
  campaign: c,
  onEdit,
  onStatusChange,
}: {
  campaign: Campaign;
  onEdit: () => void;
  onStatusChange: () => void;
}) {
  const [pending, startTransition] = useTransition();

  const statusColor =
    c.status === 'ATTIVA'
      ? 'bg-pv-green-50 text-pv-green-500'
      : c.status === 'PAUSATA'
        ? 'bg-pv-amber-50 text-pv-amber-500'
        : 'bg-pv-slate-100 text-pv-slate-700';

  const handleStatus = (next: 'ATTIVA' | 'PAUSATA' | 'CHIUSA'): void => {
    if (
      next === 'CHIUSA' &&
      !confirm('Chiudere la campagna? Non sarà più riavviabile.')
    )
      return;
    startTransition(async () => {
      await setCampaignStatusAction(c.id, next);
      onStatusChange();
    });
  };

  const filtersDescr = [
    c.regione ?? 'Tutte le regioni',
    c.cat ? (c.cat === 'BROKER' ? 'Broker' : 'Agenzie') : 'Tutti i tipi',
    c.statoTarget ?? 'Tutti gli stati',
  ].join(' · ');

  return (
    <div
      className={
        'rounded-[12px] border-[1.5px] px-4 py-3 ' +
        (c.status === 'ATTIVA'
          ? 'border-pv-green-500/40 bg-pv-green-50/20'
          : 'border-pv-slate-200 bg-white')
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-pv-navy-900">{c.nome}</p>
          <p className="text-[11.5px] text-pv-slate-500">
            Agent: {c.agentName} · {filtersDescr} · {c.assegnatiCount} contatt
            {c.assegnatiCount === 1 ? 'o' : 'i'} assegnat
            {c.assegnatiCount === 1 ? 'o' : 'i'}
          </p>
          <p className="text-[10.5px] text-pv-slate-500">
            Owner: {c.ownerName}
          </p>
        </div>
        <span
          className={
            'shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ' +
            statusColor
          }
        >
          {c.status === 'ATTIVA'
            ? '● Attiva'
            : c.status === 'PAUSATA'
              ? '⏸ Pausata'
              : '✓ Chiusa'}
        </span>
      </div>
      <p className="mt-2 text-[11px] text-pv-slate-500">
        Max {c.maxTry}/gg · Ogni {c.intervalMin} min · {c.oraStart}–{c.oraEnd}{' '}
        · {labelGiorni(c.giorniAttivi)}
      </p>
      {c.canManage && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onEdit}>
            Modifica
          </Button>
          {c.status === 'ATTIVA' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleStatus('PAUSATA')}
              disabled={pending}
            >
              Pausa
            </Button>
          )}
          {c.status === 'PAUSATA' && (
            <Button
              size="sm"
              onClick={() => handleStatus('ATTIVA')}
              disabled={pending}
            >
              Riprendi
            </Button>
          )}
          {c.status !== 'CHIUSA' && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleStatus('CHIUSA')}
              disabled={pending}
            >
              Chiudi
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// Agent modal
// ════════════════════════════════════════════════════════
function AgentModal({
  agent,
  onClose,
  onSaved,
}: {
  agent: Agent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCreate = !agent;
  const [data, setData] = useState<SalesAgentInput>({
    nome: agent?.nome ?? '',
    lingua: (agent?.lingua ?? 'ITALIANO') as SalesAgentInput['lingua'],
    voce: (agent?.voce ?? 'FEMMINILE_NATURALE') as SalesAgentInput['voce'],
    accento: (agent?.accento ?? 'NEUTRO_ITALIANO') as SalesAgentInput['accento'],
    prompt: agent?.prompt ?? '',
    scriptPrimo: agent?.scriptPrimo ?? '',
    scriptFollowup: agent?.scriptFollowup ?? '',
    qa: agent?.qa ?? '',
    postCall: agent?.postCall ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    setError(null);
    startTransition(async () => {
      const res = isCreate
        ? await createSalesAgentAction(data)
        : await updateSalesAgentAction(agent!.id, data);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

  const handleDelete = (): void => {
    if (!agent) return;
    if (!confirm(`Eliminare l'agent "${agent.nome}"?`)) return;
    startTransition(async () => {
      const res = await deleteSalesAgentAction(agent.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

  return (
    <ModalShell
      title={isCreate ? 'Nuovo Sales Agent' : `Modifica: ${agent!.nome}`}
      onClose={onClose}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FieldText
            label="Nome agent *"
            value={data.nome}
            onChange={(v) => setData({ ...data, nome: v })}
            required
            placeholder="Es. Simona — Veneto"
          />
        </div>
        <FieldSelect
          label="Lingua"
          value={data.lingua}
          options={LINGUE.map(([v, l]) => ({ value: v, label: l }))}
          onChange={(v) =>
            setData({ ...data, lingua: v as SalesAgentInput['lingua'] })
          }
        />
        <FieldSelect
          label="Voce"
          value={data.voce}
          options={VOCI.map(([v, l]) => ({ value: v, label: l }))}
          onChange={(v) =>
            setData({ ...data, voce: v as SalesAgentInput['voce'] })
          }
        />
        <FieldSelect
          label="Accento"
          value={data.accento}
          options={ACCENTI.map(([v, l]) => ({ value: v, label: l }))}
          onChange={(v) =>
            setData({ ...data, accento: v as SalesAgentInput['accento'] })
          }
        />
      </div>
      <div className="mt-3 space-y-3">
        <FieldTextarea
          label="Prompt — identità e obiettivo *"
          value={data.prompt}
          rows={4}
          onChange={(v) => setData({ ...data, prompt: v })}
        />
        <FieldTextarea
          label="Script primo contatto (S0) *"
          value={data.scriptPrimo}
          rows={3}
          onChange={(v) => setData({ ...data, scriptPrimo: v })}
        />
        <FieldTextarea
          label="Script follow-up (S4/S5) *"
          value={data.scriptFollowup}
          rows={3}
          onChange={(v) => setData({ ...data, scriptFollowup: v })}
        />
        <FieldTextarea
          label="Q&A obiezioni"
          value={data.qa}
          rows={4}
          onChange={(v) => setData({ ...data, qa: v })}
          placeholder="D: Non ho tempo — R: Ci vogliono solo 2 minuti..."
        />
        <FieldTextarea
          label="Comportamento post-chiamata"
          value={data.postCall}
          rows={3}
          onChange={(v) => setData({ ...data, postCall: v })}
          placeholder="Se interessato: invia SMS+WA+mail con link. Se non risponde: S1."
        />
      </div>
      {error && (
        <div className="mt-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      <ModalFooter
        onClose={onClose}
        primaryLabel="Salva agent"
        onPrimary={submit}
        pending={pending}
        secondary={
          !isCreate && (
            <Button
              variant="danger"
              size="sm"
              onClick={handleDelete}
              disabled={pending}
            >
              Elimina agent
            </Button>
          )
        }
      />
    </ModalShell>
  );
}

// ════════════════════════════════════════════════════════
// Campaign modal
// ════════════════════════════════════════════════════════
function CampaignModal({
  campaign,
  agents,
  onClose,
  onSaved,
}: {
  campaign: Campaign | null;
  agents: Agent[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCreate = !campaign;
  const [data, setData] = useState<CampaignInput>({
    nome: campaign?.nome ?? '',
    agentId: campaign?.agentId ?? agents[0]?.id ?? '',
    regione: (campaign?.regione ?? '') as CampaignInput['regione'],
    cat: (campaign?.cat ?? '') as CampaignInput['cat'],
    statoTarget: (campaign?.statoTarget ?? '') as CampaignInput['statoTarget'],
    maxTry: campaign?.maxTry ?? 3,
    intervalMin: campaign?.intervalMin ?? 60,
    oraStart: campaign?.oraStart ?? '09:00',
    oraEnd: campaign?.oraEnd ?? '18:00',
    giorniAttivi: (campaign?.giorniAttivi ??
      'LUN_VEN') as CampaignInput['giorniAttivi'],
    status: (campaign?.status ?? 'ATTIVA') as CampaignInput['status'],
    note: campaign?.note ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    setError(null);
    startTransition(async () => {
      const res = isCreate
        ? await createCampaignAction(data)
        : await updateCampaignAction(campaign!.id, data);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (isCreate) {
        // Per il primo lancio, comunica quanti contatti sono stati assegnati
        alert(
          `Campagna creata. ${res.assegnati} contatti assegnati con i filtri correnti.`,
        );
      }
      onSaved();
    });
  };

  const handleDelete = (): void => {
    if (!campaign) return;
    if (!confirm(`Eliminare la campagna "${campaign.nome}"?`)) return;
    startTransition(async () => {
      const res = await deleteCampaignAction(campaign.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

  return (
    <ModalShell
      title={isCreate ? 'Nuova Campagna' : `Modifica: ${campaign!.nome}`}
      onClose={onClose}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FieldText
            label="Nome campagna *"
            value={data.nome}
            onChange={(v) => setData({ ...data, nome: v })}
            required
            placeholder="Es. Veneto — Agenzie S0"
          />
        </div>
        <FieldSelect
          label="Sales agent *"
          value={data.agentId}
          options={agents.map((a) => ({ value: a.id, label: a.nome }))}
          onChange={(v) => setData({ ...data, agentId: v })}
        />
        <FieldSelect
          label="Filtro regione"
          value={(data.regione as string) ?? ''}
          options={[
            { value: '', label: 'Tutte le regioni' },
            ...REGIONI.map((r) => ({ value: r, label: r })),
          ]}
          onChange={(v) => setData({ ...data, regione: v as never })}
        />
        <FieldSelect
          label="Filtro tipo"
          value={(data.cat as string) ?? ''}
          options={[
            { value: '', label: 'Tutti i tipi' },
            { value: 'BROKER', label: 'Broker' },
            { value: 'AGENZIA', label: 'Agenzie' },
          ]}
          onChange={(v) => setData({ ...data, cat: v as never })}
        />
        <FieldSelect
          label="Filtro stato CRM"
          value={(data.statoTarget as string) ?? ''}
          options={STATI_TARGET.map((s) => ({ value: s.v, label: s.l }))}
          onChange={(v) => setData({ ...data, statoTarget: v as never })}
        />
        <FieldText
          label="Max tentativi/gg"
          type="number"
          value={String(data.maxTry)}
          onChange={(v) => setData({ ...data, maxTry: Number(v) })}
        />
        <FieldText
          label="Intervallo (min)"
          type="number"
          value={String(data.intervalMin)}
          onChange={(v) => setData({ ...data, intervalMin: Number(v) })}
        />
        <FieldText
          label="Orario inizio"
          type="time"
          value={data.oraStart}
          onChange={(v) => setData({ ...data, oraStart: v })}
        />
        <FieldText
          label="Orario fine"
          type="time"
          value={data.oraEnd}
          onChange={(v) => setData({ ...data, oraEnd: v })}
        />
        <FieldSelect
          label="Giorni attivi"
          value={data.giorniAttivi}
          options={GIORNI.map(([v, l]) => ({ value: v, label: l }))}
          onChange={(v) =>
            setData({ ...data, giorniAttivi: v as CampaignInput['giorniAttivi'] })
          }
        />
        <FieldSelect
          label="Stato campagna"
          value={data.status}
          options={[
            { value: 'ATTIVA', label: 'Attiva' },
            { value: 'PAUSATA', label: 'Pausata' },
            { value: 'CHIUSA', label: 'Chiusa' },
          ]}
          onChange={(v) =>
            setData({ ...data, status: v as CampaignInput['status'] })
          }
        />
      </div>
      <div className="mt-3">
        <FieldTextarea
          label="Note campagna"
          value={(data.note as string) ?? ''}
          rows={2}
          onChange={(v) => setData({ ...data, note: v })}
          placeholder="Obiettivo, target specifico, note operative…"
        />
      </div>
      {error && (
        <div className="mt-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      <ModalFooter
        onClose={onClose}
        primaryLabel={isCreate ? 'Lancia campagna' : 'Salva modifiche'}
        onPrimary={submit}
        pending={pending}
        secondary={
          !isCreate && (
            <Button
              variant="danger"
              size="sm"
              onClick={handleDelete}
              disabled={pending}
            >
              Elimina
            </Button>
          )
        }
      />
    </ModalShell>
  );
}

// ════════════════════════════════════════════════════════
// Shared form parts
// ════════════════════════════════════════════════════════
const REGIONI = [
  'Abruzzo',
  'Basilicata',
  'Calabria',
  'Campania',
  'Emilia-Romagna',
  'Friuli-Venezia Giulia',
  'Lazio',
  'Liguria',
  'Lombardia',
  'Marche',
  'Molise',
  'Piemonte',
  'Puglia',
  'Sardegna',
  'Sicilia',
  'Toscana',
  'Trentino-Alto Adige',
  'Umbria',
  "Valle d'Aosta",
  'Veneto',
];

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-pv-navy-900/40 px-4 py-8"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-[16px] bg-white shadow-[var(--pv-shadow-card-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-pv-slate-200 px-5 py-4">
          <h2 className="text-[16px] font-extrabold text-pv-navy-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[22px] leading-none text-pv-slate-500 hover:text-pv-navy-900"
            aria-label="Chiudi"
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

function ModalFooter({
  onClose,
  primaryLabel,
  onPrimary,
  pending,
  secondary,
}: {
  onClose: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  pending: boolean;
  secondary?: React.ReactNode;
}) {
  return (
    <footer className="mt-6 flex items-center justify-between gap-3 border-t border-pv-slate-200 px-1 pt-4">
      <div>{secondary ?? null}</div>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onClose} disabled={pending}>
          Annulla
        </Button>
        <Button
          size="sm"
          onClick={onPrimary}
          disabled={pending}
          loading={pending}
          loadingLabel="Salvataggio…"
        >
          {primaryLabel}
        </Button>
      </div>
    </footer>
  );
}

function FieldText({
  label,
  value,
  type = 'text',
  required,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  type?: string;
  required?: boolean;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
        {label}
      </span>
      {type === 'number' ? (
        <NumberInput
          value={value === '' ? null : Number(value)}
          required={required}
          placeholder={placeholder}
          integer
          onChange={(n) => onChange(n == null ? '' : String(n))}
          className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
        />
      ) : (
        <input
          type={type}
          value={value}
          required={required}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
        />
      )}
    </label>
  );
}

function FieldSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FieldTextarea({
  label,
  value,
  rows = 3,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  rows?: number;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
        {label}
      </span>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
      />
    </label>
  );
}

// Label helpers
function labelLingua(v: string): string {
  return LINGUE.find(([k]) => k === v)?.[1] ?? v;
}
function labelVoce(v: string): string {
  return VOCI.find(([k]) => k === v)?.[1] ?? v;
}
function labelAccento(v: string): string {
  return ACCENTI.find(([k]) => k === v)?.[1] ?? v;
}
function labelGiorni(v: string): string {
  return GIORNI.find(([k]) => k === v)?.[1] ?? v;
}
