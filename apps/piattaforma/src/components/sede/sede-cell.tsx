import { nomeSedeDistintivo } from '@/lib/pratiche/colonna-sede';

/**
 * Cella "Sede" della lista pratiche. `null` = pratica non ancora assegnata.
 *
 * Mostra il nome della filiale con la città sotto: la città disambigua i nomi
 * che si ripetono fra agenzie diverse ("Sede centrale"). Quando però il nome
 * della sede coincide con la ragione sociale dell'agenzia — il caso normale,
 * perché la sede creata alla registrazione eredita il nome dell'azienda —
 * ripeterlo qui accanto alla colonna Agenzia non direbbe nulla: resta la sola
 * città, che è ciò che identifica davvero la filiale.
 */
export function SedeCell({
  sede,
  agenzia,
}: {
  sede: { nome: string; citta: string } | null;
  /** Ragione sociale dell'agenzia assegnataria, per non ripeterla nella cella. */
  agenzia?: string | null;
}) {
  if (!sede) return <span className="text-pv-slate-500">—</span>;

  const nome = nomeSedeDistintivo(sede.nome, agenzia);

  if (!nome) {
    return <div className="min-w-0 truncate font-medium text-pv-slate-700">{sede.citta}</div>;
  }

  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-pv-slate-700">{nome}</div>
      <div className="truncate text-[11px] text-pv-slate-500">{sede.citta}</div>
    </div>
  );
}
