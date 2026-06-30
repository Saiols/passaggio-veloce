'use client';

import { useState, type ReactNode } from 'react';
import { logoutAction } from '@/app/(auth)/actions';
import { Modal, Button, SubmitButton } from '@/components/ui';

/**
 * Trigger di logout con MODALE di conferma graficato (non il `confirm()`
 * nativo del browser). Usato da tutte le shell (broker/agenzia/admin + topbar).
 *
 * Il bottone visibile è personalizzabile via `className` + `children` (testo
 * "Esci" oppure l'icona logout). Alla conferma il logout passa per
 * `<form action={logoutAction}>` — lo stesso meccanismo server-action già in
 * uso (signOut + redirect a /login) — con spinner via SubmitButton.
 */
export function LogoutButton({
  className,
  children,
  ariaLabel,
  title,
}: {
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className}
        aria-label={ariaLabel}
        title={title}
      >
        {children}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Esci dall'account"
        description="Vuoi davvero disconnetterti? Dovrai effettuare di nuovo l'accesso."
        size="sm"
      >
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Annulla
          </Button>
          <form action={logoutAction}>
            <SubmitButton loadingLabel="Uscita in corso…">Esci</SubmitButton>
          </form>
        </div>
      </Modal>
    </>
  );
}
