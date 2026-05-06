'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@/components/ui';
import {
  createChatbotAction,
  updateChatbotAction,
  toggleChatbotActiveAction,
  deleteChatbotAction,
  type ChatbotInput,
} from './actions';

type Bot = {
  id: string;
  nome: string;
  target: string | null;
  canale: string;
  posizione: string | null;
  attivo: boolean;
  prompt: string;
  obiettivo: string;
  qa: string;
  escalation: string;
};

const CANALI = [
  ['SITO', 'Sito', 'bg-pv-navy-700 text-white'],
  ['WHATSAPP', 'WhatsApp', 'bg-pv-green-500 text-white'],
  ['MAIL', 'Mail', 'bg-pv-orange-500 text-white'],
  ['TUTTI', 'Tutti', 'bg-pv-slate-700 text-white'],
] as const;

const TARGET = [
  ['', 'Tutti'],
  ['BROKER', 'Broker'],
  ['AGENZIA', 'Agenzia'],
] as const;

const POSIZIONI_PRESET = [
  'Homepage',
  'Pagina iscrizione',
  'Pagina pricing',
  'Pagina contatti',
  'Footer globale',
];

export function CrmChatbotClient({
  bots,
  canManage,
}: {
  bots: Bot[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Bot | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[13px] text-pv-slate-700">
          {bots.length} bot configurat{bots.length === 1 ? 'o' : 'i'}
          {' · '}
          {bots.filter((b) => b.attivo).length} attiv
          {bots.filter((b) => b.attivo).length === 1 ? 'o' : 'i'}
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setCreating(true)}>
            + Nuovo chatbot
          </Button>
        )}
      </div>

      {bots.length === 0 ? (
        <div className="rounded-[12px] border border-pv-slate-200 bg-white px-4 py-12 text-center text-[13px] text-pv-slate-500">
          Nessun chatbot configurato. Inizia con un bot per la pagina
          iscrizione del sito.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {bots.map((b) => (
            <BotCard
              key={b.id}
              bot={b}
              canManage={canManage}
              onEdit={() => setEditing(b)}
              onChange={() => router.refresh()}
            />
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ChatbotModal
          bot={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function BotCard({
  bot: b,
  canManage,
  onEdit,
  onChange,
}: {
  bot: Bot;
  canManage: boolean;
  onEdit: () => void;
  onChange: () => void;
}) {
  const [pending, startTransition] = useTransition();

  const canale = CANALI.find(([k]) => k === b.canale);
  const target = TARGET.find(([k]) => k === (b.target ?? ''));

  const handleToggle = (): void => {
    startTransition(async () => {
      await toggleChatbotActiveAction(b.id, !b.attivo);
      onChange();
    });
  };

  return (
    <div
      className={
        'rounded-[12px] border-[1.5px] px-4 py-3 ' +
        (b.attivo
          ? 'border-pv-green-500/40 bg-pv-green-50/20'
          : 'border-pv-slate-200 bg-white opacity-75')
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-pv-navy-900">💬 {b.nome}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {canale && (
              <span
                className={
                  'rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ' +
                  canale[2]
                }
              >
                {canale[1]}
              </span>
            )}
            <span className="rounded-full bg-pv-slate-100 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-pv-slate-700">
              {target?.[1] ?? 'Tutti'}
            </span>
            {b.posizione && (
              <span className="rounded-full bg-pv-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-pv-amber-500">
                📍 {b.posizione}
              </span>
            )}
            <span
              className={
                'rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ' +
                (b.attivo
                  ? 'bg-pv-green-50 text-pv-green-500'
                  : 'bg-pv-slate-100 text-pv-slate-500')
              }
            >
              {b.attivo ? '● Attivo' : '○ Inattivo'}
            </span>
          </div>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 rounded-[8px] bg-pv-slate-50 px-3 py-2 text-[12px] text-pv-slate-700">
        <span className="font-semibold text-pv-navy-900">Obiettivo: </span>
        {b.obiettivo}
      </p>
      {canManage && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onEdit}>
            Modifica
          </Button>
          <Button
            variant={b.attivo ? 'secondary' : 'primary'}
            size="sm"
            onClick={handleToggle}
            disabled={pending}
          >
            {b.attivo ? 'Disattiva' : 'Attiva'}
          </Button>
        </div>
      )}
    </div>
  );
}

function ChatbotModal({
  bot,
  onClose,
  onSaved,
}: {
  bot: Bot | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCreate = !bot;
  const [data, setData] = useState<ChatbotInput>({
    nome: bot?.nome ?? '',
    target: (bot?.target ?? '') as ChatbotInput['target'],
    canale: (bot?.canale ?? 'SITO') as ChatbotInput['canale'],
    posizione: bot?.posizione ?? '',
    attivo: bot?.attivo ?? true,
    prompt: bot?.prompt ?? '',
    obiettivo: bot?.obiettivo ?? '',
    qa: bot?.qa ?? '',
    escalation: bot?.escalation ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    setError(null);
    startTransition(async () => {
      const res = isCreate
        ? await createChatbotAction(data)
        : await updateChatbotAction(bot!.id, data);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

  const handleDelete = (): void => {
    if (!bot) return;
    if (!confirm(`Eliminare il chatbot "${bot.nome}"?`)) return;
    startTransition(async () => {
      const res = await deleteChatbotAction(bot.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

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
            {isCreate ? 'Nuovo Chatbot' : `Modifica: ${bot!.nome}`}
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

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FieldText
                label="Nome bot *"
                value={data.nome}
                onChange={(v) => setData({ ...data, nome: v })}
                placeholder="Es. Bot iscrizione agenzie"
              />
            </div>
            <FieldSelect
              label="Target"
              value={(data.target as string) ?? ''}
              options={TARGET.map(([v, l]) => ({ value: v, label: l }))}
              onChange={(v) => setData({ ...data, target: v as never })}
            />
            <FieldSelect
              label="Canale"
              value={data.canale}
              options={CANALI.map(([v, l]) => ({ value: v, label: l }))}
              onChange={(v) =>
                setData({ ...data, canale: v as ChatbotInput['canale'] })
              }
            />
            <FieldSelect
              label="Posizione"
              value={(data.posizione as string) ?? ''}
              options={[
                { value: '', label: '— libera —' },
                ...POSIZIONI_PRESET.map((p) => ({ value: p, label: p })),
              ]}
              onChange={(v) => setData({ ...data, posizione: v })}
            />
            <label className="flex items-center gap-2 self-end pb-2">
              <input
                type="checkbox"
                checked={data.attivo}
                onChange={(e) => setData({ ...data, attivo: e.target.checked })}
                className="h-4 w-4 rounded border-pv-slate-300"
              />
              <span className="text-[13px] font-semibold text-pv-navy-900">
                Bot attivo
              </span>
            </label>
          </div>

          <div className="mt-4 space-y-3">
            <FieldTextarea
              label="Prompt — identità e tono *"
              value={data.prompt}
              rows={3}
              onChange={(v) => setData({ ...data, prompt: v })}
              placeholder="Sei un assistente cordiale di Passaggio Veloce. Parli in modo chiaro e diretto..."
            />
            <FieldTextarea
              label="Obiettivo principale *"
              value={data.obiettivo}
              rows={2}
              onChange={(v) => setData({ ...data, obiettivo: v })}
              placeholder="Convertire il visitatore in iscrizione completata."
            />
            <FieldTextarea
              label="Q&A principali (D:/R: una per riga)"
              value={data.qa}
              rows={5}
              onChange={(v) => setData({ ...data, qa: v })}
              placeholder={
                'D: Quanto costa?\nR: La piattaforma è gratuita per il dealer; pagano solo le agenzie sulle pratiche concluse.\n\nD: Come funziona la firma?\nR: ...'
              }
            />
            <FieldTextarea
              label="Messaggio escalation a operatore umano *"
              value={data.escalation}
              rows={2}
              onChange={(v) => setData({ ...data, escalation: v })}
              placeholder="Mi dispiace non poterti aiutare su questo punto. Ti faccio richiamare da un operatore: lasciami il tuo numero."
            />
          </div>

          {error && (
            <div className="mt-3">
              <Alert variant="error">{error}</Alert>
            </div>
          )}

          <footer className="mt-6 flex items-center justify-between gap-3 border-t border-pv-slate-200 px-1 pt-4">
            <div>
              {!isCreate && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDelete}
                  disabled={pending}
                >
                  Elimina chatbot
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={onClose}
                disabled={pending}
              >
                Annulla
              </Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={pending}
                loading={pending}
                loadingLabel="Salvataggio…"
              >
                {isCreate ? 'Crea chatbot' : 'Salva modifiche'}
              </Button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

// Form helpers
function FieldText({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
      />
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
