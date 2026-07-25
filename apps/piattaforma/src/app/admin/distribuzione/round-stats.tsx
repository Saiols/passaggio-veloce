import { ROUND_BUCKET_MAX, type StatisticheRound } from '@/lib/distribuzione/statistiche';

/**
 * Media dei round di accettazione + istogramma. Dato admin-only: sta qui,
 * accanto ai campi che regolano raggio e durata, perché è quello che serve
 * per tararli.
 *
 * Con `intervalloMin` in config, `round N` corrisponde a circa
 * `(N-1) × durata round` di attesa: la stima in ore è mostrata sotto la media
 * per rendere leggibile il numero senza doverlo convertire a mente.
 */
export function RoundStats({
  stats,
  intervalloMin,
}: {
  stats: StatisticheRound;
  intervalloMin: number;
}) {
  const { media, campione, perRound } = stats;
  const maxCount = perRound.reduce((max, r) => Math.max(max, r.count), 0);

  return (
    <div className="rounded-[16px] border border-pv-slate-200 bg-white p-5 shadow-[var(--pv-shadow-card)]">
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
        Round di accettazione
      </h2>

      {media === null ? (
        <p className="mt-3 text-[13px] text-pv-slate-500">
          Nessuna pratica accettata tramite la distribuzione: la media comparirà qui appena
          la prima verrà presa da un&apos;agenzia.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[32px] font-extrabold leading-none tracking-tight text-pv-navy-900">
              {media.toFixed(1)}
            </span>
            <span className="text-[13px] text-pv-slate-500">
              round in media · su {campione} {campione === 1 ? 'pratica' : 'pratiche'}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-pv-slate-500">
            Circa <strong className="text-pv-navy-800">{formatAttesa(media, intervalloMin)}</strong>{' '}
            di orario lavorativo prima dell&apos;accettazione.
          </p>

          <ul className="mt-4 space-y-2">
            {perRound.map((r) => (
              <li key={r.round}>
                <div className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="text-pv-slate-600">
                    Round {r.round}
                    {r.round === ROUND_BUCKET_MAX ? '+' : ''}
                  </span>
                  <span className="shrink-0 text-pv-slate-500">
                    {r.count} ·{' '}
                    <span className="font-bold text-pv-navy-900">
                      {((r.count / campione) * 100).toFixed(0)}%
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-pv-slate-100">
                  <div
                    className="h-full bg-pv-navy-700 transition-all"
                    style={{ width: `${maxCount > 0 ? (r.count / maxCount) * 100 : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-4 text-[12px] text-pv-slate-500">
        Il round avanza solo quando parte una notifica reale: i round senza agenzie in zona
        vengono saltati e non contano. Le pratiche assegnate a mano dall&apos;admin non
        rientrano nel campione.
      </p>
    </div>
  );
}

/** Attesa media stimata: `(media - 1)` round trascorsi × durata di un round. */
function formatAttesa(media: number, intervalloMin: number): string {
  const minutiTotali = Math.round(Math.max(0, media - 1) * intervalloMin);
  if (minutiTotali < 60) return `${minutiTotali} min`;
  const h = Math.floor(minutiTotali / 60);
  const m = minutiTotali % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
