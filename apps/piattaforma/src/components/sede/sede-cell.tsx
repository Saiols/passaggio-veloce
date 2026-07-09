/**
 * Cella "Sede" della lista pratiche: nome della filiale e, sotto, la città.
 * La città disambigua i nomi che si ripetono fra agenzie diverse ("Sede
 * centrale"). `null` = pratica non ancora assegnata a una sede.
 */
export function SedeCell({ sede }: { sede: { nome: string; citta: string } | null }) {
  if (!sede) return <span className="text-pv-slate-500">—</span>;

  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-pv-slate-700">{sede.nome}</div>
      <div className="truncate text-[11px] text-pv-slate-500">{sede.citta}</div>
    </div>
  );
}
