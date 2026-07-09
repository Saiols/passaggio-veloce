import { formatCurrencyCent, formatDateTime } from '@/lib/format';
import { Card, StatCard } from '@/components/ui';
import { labelTipoTx, isPenale, CLASSI_RIGA_PENALE } from './movimenti';
import type { TransazioneWalletTipo } from '@pv/db';

export type RigaSede = { sedeId: string; nome: string; saldoCent: number };
export type MovimentoAggregato = {
  id: string;
  createdAt: Date;
  /**
   * Tipo grezzo dell'enum Prisma: l'etichetta la applica questo componente.
   * Tipizzato con l'enum e non con `string` apposta: se il chiamante passasse
   * già un'etichetta (es. `labelTipoTx(t.tipo)`), `isPenale` fallirebbe sempre
   * in silenzio — con `string` compilerebbe comunque. Un enum è assegnabile a
   * `string`, quindi qui non si perde nulla.
   */
  tipo: TransazioneWalletTipo;
  importoCent: number;
  /** Nome della sede, oppure `null` per il wallet madre (affiliazione). */
  origine: string | null;
};

/**
 * Wallet in vista aggregata: il proprietario non ha selezionato una sede, quindi
 * vede la somma di tutte. È di sola lettura — per incassare bisogna scegliere
 * una sede, perché il payout è un'operazione di quella sede.
 */
export function WalletAggregato({
  totaleCent,
  saldoAffiliazioneCent,
  righe,
  movimenti,
}: {
  totaleCent: number;
  saldoAffiliazioneCent: number;
  righe: RigaSede[];
  movimenti: MovimentoAggregato[];
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
          Seleziona una sede dal menù in alto per vederne i movimenti e richiedere il payout.
        </p>
        <div className="mt-4 divide-y divide-pv-slate-200">
          {righe.map((r) => (
            <div key={r.sedeId} className="flex items-center justify-between py-3">
              <span className="text-sm font-medium text-pv-slate-700">{r.nome}</span>
              <span
                className={`text-sm font-semibold ${
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
        <h2 className="text-base font-bold text-pv-navy-900">Movimenti recenti</h2>
        <div className="mt-4 divide-y divide-pv-slate-200">
          {movimenti.length === 0 ? (
            <p className="py-6 text-center text-sm text-pv-slate-500">Nessun movimento.</p>
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
                    {formatDateTime(m.createdAt)}
                    {m.origine ? ` · ${m.origine}` : ' · Affiliazione'}
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
