'use client';

import { useState } from 'react';
import { AddUserModal } from './add-user-modal';

export function TeamPageClient() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-[10px] bg-pv-navy-700 px-4 py-2 text-[13px] font-semibold text-white hover:bg-pv-navy-800 sm:self-end"
      >
        + Aggiungi utente
      </button>
      <AddUserModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
