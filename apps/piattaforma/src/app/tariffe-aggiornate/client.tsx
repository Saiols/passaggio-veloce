'use client';

import { useState, useTransition } from 'react';
import { Alert, Button } from '@/components/ui';
import { riaccettaTariffaAction } from './actions';

/**
 * Conferma delle nuove condizioni economiche. Il bottone è abilitato solo dopo
 * la spunta: la clausola 3 chiede una riaccettazione ESPLICITA, e un click su
 * un bottone che si potrebbe premere senza aver letto nulla non lo è.
 */
export function RiaccettazioneForm(props: { isTitolare: boolean }) {
  const [letto, setLetto] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [fatto, setFatto] = useState(false);
  const [pending, start] = useTransition();

  if (fatto) {
    return (
      <Alert variant="success" title="Condizioni accettate">
        Puoi tornare a inviare e accettare pratiche. Le nuove condizioni si applicano alle pratiche
        da qui in avanti.
      </Alert>
    );
  }

  if (!props.isTitolare) {
    return (
      <Alert variant="info" title="Serve il titolare dell’account">
        Le nuove condizioni economiche vincolano l’azienda, quindi può accettarle solo
        l’amministratore titolare. Nel frattempo puoi continuare a lavorare le pratiche già in
        corso, che restano alle condizioni precedenti.
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {msg && (
        <Alert variant="error" title="Non è stato possibile registrare l’accettazione">
          {msg}
        </Alert>
      )}
      <label className="flex cursor-pointer items-start gap-3 rounded-[12px] border-[1.5px] border-pv-slate-200 bg-pv-slate-50 px-4 py-3">
        <input
          type="checkbox"
          checked={letto}
          onChange={(e) => setLetto(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-pv-navy-700"
        />
        <span className="text-[13px] font-semibold text-pv-navy-800">
          Ho letto le nuove condizioni economiche e le accetto per la mia azienda
        </span>
      </label>
      <Button
        onClick={() => {
          setMsg(null);
          start(async () => {
            const r = await riaccettaTariffaAction();
            if (r.ok) setFatto(true);
            else setMsg(r.error);
          });
        }}
        disabled={!letto || pending}
        loading={pending}
        loadingLabel="Registro…"
      >
        Accetta le nuove condizioni
      </Button>
    </div>
  );
}
