'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, PasswordInput } from '@/components/ui';
import {
  createCrmTeamUserAction,
  updateCrmTeamUserAction,
  resetCrmTeamUserPasswordAction,
  deleteCrmTeamUserAction,
} from './actions';
import type { Role } from '@/lib/auth/permissions';

type UserRow = {
  id: string;
  nome: string;
  cognome: string;
  email: string;
  role: string;
  lastLoginAt: string | null;
  createdAt: string;
  canManage: boolean;
};

const ROLE_LABEL: Record<string, string> = {
  ADMIN_PIATTAFORMA: 'Admin Piattaforma',
  AD: 'AD',
  CTO: 'CTO',
  CFO: 'CFO',
  SALES_MANAGER: 'Sales Manager',
  SALES: 'Sales',
};

const ROLE_BADGE: Record<string, string> = {
  ADMIN_PIATTAFORMA: 'bg-pv-navy-100 text-pv-navy-700',
  AD: 'bg-purple-100 text-purple-700',
  CTO: 'bg-blue-100 text-blue-700',
  CFO: 'bg-pv-amber-50 text-pv-amber-500',
  SALES_MANAGER: 'bg-pv-green-50 text-pv-green-500',
  SALES: 'bg-pv-slate-100 text-pv-slate-700',
};

export function CrmUsersClient({
  users,
  allowedRoles,
  currentUserId,
}: {
  users: UserRow[];
  allowedRoles: Role[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);

  const canCreate = allowedRoles.length > 0;

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-[13px] text-pv-slate-700">
          {users.length} utent{users.length === 1 ? 'e' : 'i'} attiv{users.length === 1 ? 'o' : 'i'}
        </p>
        {canCreate && (
          <Button size="sm" onClick={() => setCreating(true)}>
            + Nuovo utente team
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
        <table className="w-full text-[13px]">
          <thead className="border-b border-pv-slate-200 bg-pv-slate-50 text-left text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Ruolo</th>
              <th className="px-4 py-3 text-right">Azioni</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-pv-slate-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-semibold text-pv-navy-900">
                  {u.nome} {u.cognome}
                  {u.id === currentUserId && (
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-pv-slate-500">
                      (tu)
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-pv-slate-700">{u.email}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      'inline-flex rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ' +
                      (ROLE_BADGE[u.role] ?? 'bg-pv-slate-100 text-pv-slate-700')
                    }
                  >
                    {ROLE_LABEL[u.role] ?? u.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {u.canManage ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditing(u)}
                    >
                      Modifica
                    </Button>
                  ) : (
                    <span className="text-[11px] text-pv-slate-500">—</span>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-12 text-center text-[13px] text-pv-slate-500"
                >
                  Nessun utente team configurato.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <CreateUserModal
          allowedRoles={allowedRoles}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            router.refresh();
          }}
        />
      )}
      {editing && (
        <EditUserModal
          user={editing}
          allowedRoles={allowedRoles}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════
// Create modal
// ════════════════════════════════════════════════════════
function CreateUserModal({
  allowedRoles,
  onClose,
  onSaved,
}: {
  allowedRoles: Role[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nome, setNome] = useState('');
  const [cognome, setCognome] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(allowedRoles[0] ?? 'SALES');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await createCrmTeamUserAction({
        nome,
        cognome,
        email,
        role,
        password,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

  return (
    <ModalShell title="Nuovo utente team" onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldText label="Nome *" value={nome} onChange={setNome} required />
        <FieldText
          label="Cognome *"
          value={cognome}
          onChange={setCognome}
          required
        />
        <div className="sm:col-span-2">
          <FieldText
            label="Email *"
            type="email"
            value={email}
            onChange={setEmail}
            required
          />
        </div>
        <FieldSelect
          label="Ruolo *"
          value={role}
          onChange={(v) => setRole(v as Role)}
          options={allowedRoles.map((r) => ({
            value: r,
            label: ROLE_LABEL[r] ?? r,
          }))}
        />
        <FieldText
          label="Password *"
          type="password"
          value={password}
          onChange={setPassword}
          required
          hint="Min 8 char, maiuscola, minuscola, cifra"
        />
      </div>
      {error && (
        <div className="mt-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      <ModalFooter
        onClose={onClose}
        primaryLabel="Crea utente"
        onPrimary={submit}
        pending={pending}
      />
    </ModalShell>
  );
}

// ════════════════════════════════════════════════════════
// Edit modal (con reset password integrato)
// ════════════════════════════════════════════════════════
function EditUserModal({
  user,
  allowedRoles,
  onClose,
  onSaved,
}: {
  user: UserRow;
  allowedRoles: Role[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nome, setNome] = useState(user.nome);
  const [cognome, setCognome] = useState(user.cognome);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<Role>(user.role as Role);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Il currentRole può non essere assegnabile (es. SM non può creare CTO),
  // ma può comunque mantenere il ruolo esistente. Lista dropdown:
  // ruoli creatable + l'attuale anche se non in lista.
  const roleOptions = Array.from(
    new Set<string>([...allowedRoles, user.role]),
  ).map((r) => ({
    value: r,
    label: ROLE_LABEL[r] ?? r,
  }));

  const submit = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await updateCrmTeamUserAction(user.id, {
        nome,
        cognome,
        email,
        role,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

  const handleReset = (): void => {
    if (!confirm('Generare una nuova password? La password attuale smette di funzionare.')) return;
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const res = await resetCrmTeamUserPasswordAction(user.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNewPassword(res.newPassword);
    });
  };

  const handleCopy = async (): Promise<void> => {
    if (!newPassword) return;
    try {
      await navigator.clipboard.writeText(newPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Impossibile copiare. Selezionala manualmente.');
    }
  };

  const handleDelete = (): void => {
    if (
      !confirm(
        `Eliminare l'utente ${user.nome} ${user.cognome}? Operazione non reversibile.`,
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await deleteCrmTeamUserAction(user.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  };

  return (
    <ModalShell title={`Modifica ${user.nome} ${user.cognome}`} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldText label="Nome *" value={nome} onChange={setNome} required />
        <FieldText
          label="Cognome *"
          value={cognome}
          onChange={setCognome}
          required
        />
        <div className="sm:col-span-2">
          <FieldText
            label="Email *"
            type="email"
            value={email}
            onChange={setEmail}
            required
          />
        </div>
        <FieldSelect
          label="Ruolo *"
          value={role}
          onChange={(v) => setRole(v as Role)}
          options={roleOptions}
        />
      </div>

      <div className="mt-5 rounded-[12px] border border-pv-slate-200 bg-pv-slate-50 p-4">
        <h3 className="text-[13px] font-bold text-pv-navy-800">
          Reset password
        </h3>
        <p className="mt-1 text-[12px] text-pv-slate-700">
          Genera una nuova password mostrata <strong>una sola volta</strong>.
          Comunicala fuori piattaforma.
        </p>
        {newPassword ? (
          <div className="mt-3">
            <Alert variant="success" title="Password rigenerata">
              Copia subito la password — chiusa questa finestra non sarà più
              recuperabile.
            </Alert>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="flex-1 select-all break-all rounded-[8px] border border-pv-slate-200 bg-white px-3 py-2 font-mono text-[14px] font-semibold text-pv-navy-800">
                {newPassword}
              </code>
              <Button size="sm" onClick={handleCopy}>
                {copied ? 'Copiato!' : 'Copia'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <Button
              variant="danger"
              size="sm"
              onClick={handleReset}
              disabled={pending}
            >
              Genera nuova password
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <ModalFooter
        onClose={onClose}
        primaryLabel="Salva modifiche"
        onPrimary={submit}
        pending={pending}
        secondary={
          <Button
            variant="danger"
            size="sm"
            onClick={handleDelete}
            disabled={pending}
          >
            Elimina utente
          </Button>
        }
      />
    </ModalShell>
  );
}

// ════════════════════════════════════════════════════════
// Shared modal scaffolding
// ════════════════════════════════════════════════════════
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
        className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-[16px] bg-white shadow-[var(--pv-shadow-card-lg)]"
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
  hint,
}: {
  label: string;
  value: string;
  type?: string;
  required?: boolean;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
        {label}
      </span>
      {type === 'password' ? (
        <PasswordInput
          value={value}
          required={required}
          onChange={(e) => onChange(e.target.value)}
          containerClassName="mt-1"
          className="w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
        />
      ) : (
        <input
          type={type}
          value={value}
          required={required}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
        />
      )}
      {hint && (
        <span className="mt-0.5 block text-[10.5px] text-pv-slate-500">{hint}</span>
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
