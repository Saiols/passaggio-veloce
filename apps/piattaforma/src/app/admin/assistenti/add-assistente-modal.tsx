'use client';

import { Modal } from '@/components/ui';
import { CreateAssistenteForm } from './create-form';

export function AddAssistenteModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Nuovo assistente"
      description="Account operativo con accesso a pratiche, anagrafiche, wallet, catalogo contatti ed escalation. L'account è attivo da subito."
    >
      <CreateAssistenteForm onSuccess={onClose} />
    </Modal>
  );
}
