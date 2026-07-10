'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui';
import type { CompanyTypeP, Permesso } from '@/lib/auth/permessi/catalogo';
import { CreateUserForm } from './create-user-form';
import { InviteForm } from './invite-form';

type Tab = 'password' | 'invite';

export function AddUserModal({
  open,
  onClose,
  sedi = [],
  companyType,
  assegnabili,
  puoScegliere,
}: {
  open: boolean;
  onClose: () => void;
  sedi?: { id: string; nome: string }[];
  companyType: CompanyTypeP;
  assegnabili: Permesso[];
  puoScegliere: boolean;
}) {
  const [tab, setTab] = useState<Tab>('password');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Aggiungi utente"
      description="Crea l'account direttamente impostando una password, oppure invia un invito via email."
    >
      <div className="mb-4 flex gap-1 rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 p-1">
        <button
          type="button"
          onClick={() => setTab('password')}
          className={`flex-1 rounded-[8px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
            tab === 'password'
              ? 'bg-white text-pv-navy-900 shadow-sm'
              : 'text-pv-slate-500 hover:text-pv-navy-700'
          }`}
        >
          Imposta password
        </button>
        <button
          type="button"
          onClick={() => setTab('invite')}
          className={`flex-1 rounded-[8px] px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
            tab === 'invite'
              ? 'bg-white text-pv-navy-900 shadow-sm'
              : 'text-pv-slate-500 hover:text-pv-navy-700'
          }`}
        >
          Invita via email
        </button>
      </div>

      {tab === 'password' ? (
        <CreateUserForm
          onSuccess={onClose}
          sedi={sedi}
          companyType={companyType}
          assegnabili={assegnabili}
          puoScegliere={puoScegliere}
        />
      ) : (
        <InviteForm
          onSuccess={onClose}
          sedi={sedi}
          companyType={companyType}
          assegnabili={assegnabili}
          puoScegliere={puoScegliere}
        />
      )}
    </Modal>
  );
}
