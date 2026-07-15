'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ibanItSchema } from '@pv/lib';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { useFieldErrorsState, zodFieldErrors } from '@/components/forms';
import { z } from 'zod';
import { ritentaAddebitoAction, aggiornaIbanERitentaAction } from './actions';

const ibanFormSchema = z.object({ iban: ibanItSchema });

export function BloccoPagamentoClient({
  isOwner,
  ibanAttuale,
  motivo,
  inElaborazione,
}: {
  /** Solo il titolare dell'account può aggiornare l'IBAN. */
  isOwner: boolean;
  ibanAttuale: string;
  motivo: string | null;
  inElaborazione: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [iban, setIban] = useState(ibanAttuale);

  const errors = zodFieldErrors(ibanFormSchema, { iban });
  const { field, gatedSubmit } = useFieldErrorsState(errors);
  const fIban = field('iban');

  const onRetry = () => {
    setError(null);
    start(async () => {
      const r = await ritentaAddebitoAction();
      if (!r.ok) {
        setError(r.error);
      } else {
        router.refresh();
      }
    });
  };

  const onAggiornaIban = (): void => {
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set('iban', iban);
      const r = await aggiornaIbanERitentaAction(fd);
      if (!r.ok) {
        setError(r.error);
      } else {
        router.refresh();
      }
    });
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-[22px] font-bold text-pv-navy-900">Account momentaneamente sospeso</h1>
      <Alert variant="error" className="mt-4">
        Non ha funzionato l&apos;addebito automatico, il tuo account è stato momentaneamente
        sospeso.{' '}
        {isOwner
          ? "Aggiorna l'IBAN inserito nella piattaforma, oppure richiedi un nuovo tentativo se hai già sistemato con la banca."
          : 'Richiedi un nuovo tentativo se avete già sistemato con la banca.'}
      </Alert>
      {motivo && <p className="mt-2 text-[12.5px] text-pv-slate-500">Dettaglio: {motivo}</p>}

      {inElaborazione ? (
        <Alert variant="info" className="mt-6">
          Addebito in elaborazione: attendi la conferma. La pagina si aggiornerà quando
          l&apos;esito è disponibile.
        </Alert>
      ) : (
        <>
          {isOwner ? (
            <form onSubmit={gatedSubmit(onAggiornaIban)} noValidate className="mt-6 space-y-3">
              <Field label="Aggiorna IBAN" required error={fIban.error}>
                <Input
                  name="iban"
                  value={iban}
                  onChange={(e) => setIban(e.target.value)}
                  onBlur={fIban.onBlur}
                  invalid={fIban.invalid}
                  placeholder="IT60..."
                  maxLength={34}
                  disabled={pending}
                />
              </Field>
              <Button type="submit" loading={pending} loadingLabel="Aggiornamento…">
                Aggiorna IBAN e riprova
              </Button>
            </form>
          ) : (
            <Alert variant="info" className="mt-6">
              Solo il titolare dell&apos;account può aggiornare l&apos;IBAN. Contattalo per
              procedere.
            </Alert>
          )}

          <div className="mt-6 border-t border-pv-slate-200 pt-6">
            <p className="text-[13px] text-pv-slate-600">
              {isOwner
                ? 'Hai già sistemato con la banca senza cambiare IBAN?'
                : 'Avete già sistemato con la banca senza cambiare IBAN?'}
            </p>
            <Button variant="secondary" onClick={onRetry} loading={pending} loadingLabel="Riprovo…" className="mt-2">
              Riprova l&apos;addebito
            </Button>
          </div>
        </>
      )}

      {error && <Alert variant="error" className="mt-4">{error}</Alert>}
      <LoadingOverlay show={pending} label="Attendere…" />
    </div>
  );
}
