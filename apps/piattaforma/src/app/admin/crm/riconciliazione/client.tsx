'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@/components/ui';
import { useActionOverlay } from '@/components/ui/use-action-overlay';
import type { Proposta } from '@/lib/crm/match/engine';
import { applicaRiconciliazioneAction } from './actions';

const ETICHETTE: Record<string, string> = {
  piva: 'P.IVA',
  email: 'Email',
  tel: 'Telefono',
  nome: 'Nome',
  'nome~': 'Nome simile',
  indirizzo: 'Indirizzo',
  cap: 'CAP',
  citta: 'Città',
};

export function RiconciliazioneClient({
  proposte,
  totale,
  broker,
  agenzia,
  ambigue,
  mostrate,
}: {
  proposte: Proposta[];
  totale: number;
  broker: number;
  agenzia: number;
  ambigue: number;
  mostrate: number;
}) {
  const router = useRouter();
  const [esito, setEsito] = useState<string | null>(null);
  const { run, pending, overlay } = useActionOverlay('Aggancio in corso…');

  const applica = () =>
    run(async () => {
      const res = await applicaRiconciliazioneAction();
      // `saltati` va detto sempre, anche a zero: l'aggancio è irreversibile e
      // questo è l'unico riscontro che l'admin riceve. Senza, «0 righe
      // agganciate» non distingue "l'ha già fatto il cron stanotte" da
      // "qualcosa è andato storto".
      setEsito(
        res.ok
          ? `${res.agganciati} righe agganciate, ${res.saltati} saltate` +
              ` (già agganciate o cambiate nel frattempo)` +
              `${res.errori > 0 ? `, ${res.errori} errori` : ''}.`
          : res.error,
      );
      router.refresh();
    });

  // Il blocco esito va mostrato SEMPRE se valorizzato, anche quando `totale`
  // è sceso a zero: è il caso normale di successo pieno (router.refresh()
  // dopo l'apply fa sparire tutte le proposte già agganciate). Un return
  // anticipato sul ramo "nessuna proposta" prima di questo blocco farebbe
  // sparire proprio il numero che l'utente è venuto a vedere.
  return (
    <>
      {overlay}
      {esito ? (
        <div className="mb-4">
          <Alert variant="info" title="Esito">
            {esito}
          </Alert>
        </div>
      ) : null}

      {totale === 0 ? (
        <Alert variant="info" title="Nessuna proposta">
          Ogni azienda registrata è già agganciata alla sua riga, oppure
          nessuna riga della lista condivide un identificativo forte con le
          aziende registrate.
        </Alert>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-pv-slate-200 bg-white p-4 shadow-[var(--pv-shadow-card)]">
            <p className="text-[13px] text-pv-slate-700">
              <span className="font-bold text-pv-navy-900">{totale}</span> righe
              verranno agganciate — {broker} broker, {agenzia} agenzie.
              {mostrate < totale ? ` In anteprima le prime ${mostrate}.` : ''}
            </p>
            <Button onClick={applica} disabled={pending}>
              Applica
            </Button>
          </div>

          {ambigue > 0 ? (
            <div className="mb-4">
              <Alert variant="info" title="Righe ambigue: le applica solo questa pagina">
                {ambigue === 1
                  ? '1 riga ha un pari merito'
                  : `${ambigue} righe hanno un pari merito`}{' '}
                con un&apos;altra: stesso punteggio, stessa prova. La scelta fra
                le due è deterministica ma arbitraria, e un aggancio non si può
                disfare. Per questo la passata automatica notturna le lascia
                indietro: vengono agganciate solo se sei tu a premere «Applica»
                qui. Sono marcate «Ambigua» in elenco e messe in cima.
              </Alert>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-[16px] border border-pv-slate-200 bg-white shadow-[var(--pv-shadow-card)]">
            <table className="w-full min-w-[880px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-pv-slate-200 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
                  <th className="px-4 py-3">Riga in lista</th>
                  <th className="px-4 py-3">Azienda registrata</th>
                  <th className="px-4 py-3">Campi in comune</th>
                  <th className="px-4 py-3 text-right">Punteggio</th>
                </tr>
              </thead>
              <tbody>
                {proposte.map((p) => (
                  <tr
                    key={p.contactId}
                    className="border-b border-pv-slate-100 last:border-0"
                  >
                    <td className="px-4 py-2.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-pv-navy-900">
                          {p.contactNome}
                        </span>
                        {p.ambigua ? (
                          <span className="rounded-full bg-pv-amber-50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-pv-amber-500">
                            Ambigua
                          </span>
                        ) : null}
                      </span>
                      <span className="block text-[12px] text-pv-slate-500">
                        {[p.contactTel, p.contactCitta].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-pv-navy-900">{p.companyNome}</span>
                      <span className="block text-[12px] text-pv-slate-500">
                        {p.sedeNome ? `Sede: ${p.sedeNome}` : 'Sede principale'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        {p.campi.map((c) => (
                          <span
                            key={c}
                            className="rounded-[6px] bg-pv-slate-100 px-2 py-0.5 text-[11.5px] font-semibold text-pv-navy-700"
                          >
                            {ETICHETTE[c] ?? c}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold text-pv-navy-900">
                      {p.punteggio}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
