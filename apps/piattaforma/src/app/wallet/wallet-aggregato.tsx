import { formatCurrencyCent, formatDateTime } from '@/lib/format';
import { Card, StatCard } from '@/components/ui';
import { labelTipoTx, isPenale, CLASSI_RIGA_PENALE } from './movimenti';
import type { TransazioneWalletTipo } from '@pv/db';
import { FILTRO_MOVIMENTI_AZIENDA, type RigaSede } from './wallet-aggregato-data';

export type MovimentoAggregato = {
  id: string;
  createdAt: Date;
  /** Tipo grezzo dell'enum Prisma; l'etichetta viene applicata in presentazione. */
  tipo: TransazioneWalletTipo;
  importoCent: number;
  sedeId: string | null;
  /** Nome della sede, oppure etichetta aziendale per un movimento non attribuibile. */
  sedeNome: string;
};

/** Vista aggregata e di sola lettura del proprietario dell'organizzazione. */
export function WalletAggregato({
  totaleCent,
  saldoAffiliazioneCent,
  righe,
  movimenti,
  sedi,
  filtroSede,
}: {
  totaleCent: number;
  saldoAffiliazioneCent: number;
  righe: RigaSede[];
  movimenti: MovimentoAggregato[];
  sedi: { id: string; nome: string }[];
  filtroSede: string | null;
}) {
  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Totale di tutte le sedi" value={formatCurrencyCent(totaleCent)} />
        <StatCard
          label="di cui commissioni affiliazione"
          value={formatCurrencyCent(saldoAffiliazioneCent)}
        />
      </div>

      <Card className="mb-6">
        <h2 className="text-base font-bold text-pv-navy-900">Saldo per sede</h2>
        <p className="mt-1 text-sm text-pv-slate-500">
          Include il saldo operativo e le commissioni di affiliazione attribuite a ogni sede.
        </p>
        <div className="mt-4 divide-y divide-pv-slate-200">
          {righe.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium text-pv-slate-700">{r.nome}</p>
                {r.saldoAffiliazioneCent !== 0 && r.sedeId && (
                  <p className="mt-0.5 text-[11px] text-pv-slate-500">
                    di cui affiliazione {formatCurrencyCent(r.saldoAffiliazioneCent)}
                  </p>
                )}
              </div>
              <span
                className={`shrink-0 text-sm font-semibold ${
                  r.saldoCent < 0 ? 'text-pv-red-500' : 'text-pv-navy-800'
                }`}
              >
                {formatCurrencyCent(r.saldoCent)}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-base font-bold text-pv-navy-900">Movimenti recenti</h2>
          <form method="get" className="flex items-end gap-2">
            <label
              htmlFor="wallet-filtro-sede"
              className="grid gap-1 text-[11px] font-bold uppercase tracking-wider text-pv-slate-500"
            >
              Sede
              <select
                id="wallet-filtro-sede"
                name="sede"
                defaultValue={filtroSede ?? ''}
                className="min-w-44 rounded-lg border border-pv-slate-300 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-pv-navy-800 outline-none focus:border-pv-navy-500 focus:ring-2 focus:ring-pv-navy-100"
              >
                <option value="">Tutte le sedi</option>
                {sedi.map((sede) => (
                  <option key={sede.id} value={sede.id}>
                    {sede.nome}
                  </option>
                ))}
                <option value={FILTRO_MOVIMENTI_AZIENDA}>Aziendale / senza sede</option>
              </select>
            </label>
            <button
              type="submit"
              className="rounded-lg bg-pv-navy-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-pv-navy-800"
            >
              Filtra
            </button>
          </form>
        </div>
        <div className="mt-4 divide-y divide-pv-slate-200">
          {movimenti.length === 0 ? (
            <p className="py-6 text-center text-sm text-pv-slate-500">
              Nessun movimento per il filtro selezionato.
            </p>
          ) : (
            movimenti.map((m) => (
              <div
                key={m.id}
                className={`flex items-center justify-between gap-3 py-3 ${
                  isPenale(m.tipo) ? CLASSI_RIGA_PENALE : ''
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-pv-slate-700">
                    {labelTipoTx(m.tipo)}
                  </p>
                  <p className="text-[12px] text-pv-slate-500">
                    {m.sedeNome} · {formatDateTime(m.createdAt)}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-sm font-semibold ${
                    m.importoCent < 0 ? 'text-pv-red-500' : 'text-pv-green-500'
                  }`}
                >
                  {formatCurrencyCent(m.importoCent)}
                </span>
              </div>
            ))
          )}
        </div>
      </Card>
    </>
  );
}
