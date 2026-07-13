'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { formatCurrencyCent } from '@/lib/format';
import { attestaFirmaAdminAction } from '@/app/admin/pratiche/actions';

/**
 * Attestazione della firma da parte del Gestore (Termini, art. 11).
 *
 * Il modale elenca gli EFFETTI ECONOMICI REALI di questa pratica, con gli
 * importi presi dal record: chi preme deve vedere quanti soldi muove, non un
 * generico "sei sicuro?". La motivazione è obbligatoria — è la nostra prova.
 */
export function AttestaFirmaButton({
  praticaId,
  feeAgenziaCent,
  creditoBrokerCent,
  nomeAgenzia,
  nomeBroker,
}: {
  praticaId: string;
  feeAgenziaCent: number;
  creditoBrokerCent: number;
  nomeAgenzia: string;
  nomeBroker: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleConferma = (): void => {
    setError(null);
    startTransition(async () => {
      const res = await attestaFirmaAdminAction(praticaId, motivo);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Attesta firma avvenuta
      </Button>

      <Modal
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title="Attestare la firma al posto dell'agenzia?"
        description="La pratica si perfeziona immediatamente e produce tutti gli effetti economici. Operazione non reversibile."
        size="md"
      >
        <div className="space-y-4">
          <Alert variant="warning" title="Cosa succede quando confermi">
            <ul className="mt-1 list-disc space-y-1 pl-4 text-[13px]">
              <li>
                Addebito di <strong>{formatCurrencyCent(feeAgenziaCent)}</strong> a{' '}
                <strong>{nomeAgenzia}</strong>
              </li>
              <li>
                Accredito di <strong>{formatCurrencyCent(creditoBrokerCent)}</strong> sul wallet
                di <strong>{nomeBroker}</strong>
              </li>
              <li>Emissione della fattura verso l&apos;agenzia</li>
              <li>Sblocco del payout automatico al broker</li>
            </ul>
          </Alert>

          <label className="block">
            <span className="text-[12px] font-semibold text-pv-slate-700">
              Motivazione (obbligatoria, max 500 caratteri)
            </span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Es. Firma confermata telefonicamente da Rossi (agenzia) il 13/07; copia dell'atto ricevuta via email."
              className="mt-1 w-full rounded-[10px] border-[1.5px] border-pv-slate-300 px-3 py-2 text-[13px]"
            />
            <span className="mt-1 block text-[11px] text-pv-slate-500">
              Resta registrata insieme al tuo nome e alla data. Non viene mostrata a broker e
              agenzia, che vedranno solo che la firma è stata attestata dal team.
            </span>
          </label>

          {error && <Alert variant="error">{error}</Alert>}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Annulla
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleConferma}
              disabled={pending || !motivo.trim()}
              loading={pending}
              loadingLabel="Attesto…"
            >
              Conferma attestazione
            </Button>
          </div>
        </div>
        <LoadingOverlay show={pending} label="Attestazione in corso…" />
      </Modal>
    </>
  );
}
