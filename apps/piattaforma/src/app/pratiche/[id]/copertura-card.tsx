import { Card } from '@/components/ui';
import { formatKm } from '@/lib/distribuzione/format';
import { labelMotivo, type Copertura } from '@/lib/distribuzione/copertura';

/**
 * Diagnostica admin-only: quali agenzie ci sono in zona e, per ciascuna, se è
 * stata contattata, se aspetta il suo round o perché è stata esclusa.
 *
 * Esiste perché quattro dei cinque motivi di mancato contatto (coordinate,
 * visura, sospensioni, blocco pagamento) agiscono in silenzio: senza questa
 * card, "non è mai arrivata" non è distinguibile da "non è ancora il suo turno".
 */
export function CoperturaCard({ copertura }: { copertura: Copertura }) {
  const { sedi, senzaCoordinate, raggioMaxM, raggioCorrenteM, origineMancante } = copertura;

  return (
    <Card>
      <h2 className="text-[15px] font-bold text-pv-navy-800">Copertura</h2>
      <p className="mt-1 text-[12px] text-pv-slate-500">
        Agenzie entro il raggio massimo ({formatKm(raggioMaxM)}), in linea d&apos;aria.
        {raggioCorrenteM != null && ` Raggio attuale: ${formatKm(raggioCorrenteM)}.`}
      </p>

      {origineMancante && (
        <p className="mt-3 rounded-[10px] bg-pv-amber-50 px-3 py-2 text-[12.5px] text-pv-navy-800">
          La pratica non ha coordinate: nessuna distanza è calcolabile e la
          distribuzione automatica non può selezionare agenzie.
        </p>
      )}

      {!origineMancante && sedi.length === 0 && (
        <p className="mt-3 text-[13px] text-pv-slate-500">
          Nessuna agenzia entro il raggio massimo.
        </p>
      )}

      <ul className="mt-3 space-y-2 text-[13px]">
        {sedi.map((s) => (
          <li
            key={s.sedeId}
            className="flex items-center justify-between gap-3 rounded-[10px] border border-pv-slate-200 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate font-semibold text-pv-navy-800">{s.ragioneSociale}</p>
              <p className="text-[11px] text-pv-slate-500">
                {s.citta} · {formatKm(s.distanzaM)}
              </p>
            </div>
            <span className="shrink-0 text-right text-[11px]">
              {s.stato === 'contattata' && (
                <span className="font-bold uppercase tracking-wider text-pv-slate-500">
                  R{s.round} · {s.esito?.toLowerCase().replace('_', ' ')}
                </span>
              )}
              {s.stato === 'in-attesa' && (
                <span className="text-pv-slate-500">in attesa del round</span>
              )}
              {s.stato === 'esclusa' && s.motivo && (
                <span className="font-semibold text-pv-red-500">{labelMotivo(s.motivo)}</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {senzaCoordinate.length > 0 && (
        <div className="mt-4 rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 px-3 py-2">
          <p className="text-[12px] font-semibold text-pv-navy-800">
            {senzaCoordinate.length}{' '}
            {senzaCoordinate.length === 1 ? 'sede senza' : 'sedi senza'} coordinate
          </p>
          <p className="mt-1 text-[11.5px] text-pv-slate-500">
            Posizione ignota: non è possibile dire se siano in zona, e la distribuzione
            non le seleziona mai. {senzaCoordinate.map((s) => `${s.nome} (${s.citta})`).join(', ')}
          </p>
        </div>
      )}
    </Card>
  );
}
