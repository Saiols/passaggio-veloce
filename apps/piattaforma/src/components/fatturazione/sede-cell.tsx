import { resolveSedeRiferimento } from '@/lib/fatturazione/descrizione';

/**
 * Cella "Sede" condivisa dalle liste fatture (agenzia / broker / admin): mostra
 * il nome della sede a cui il documento si riferisce, con città/provincia come
 * tooltip. I dati fiscali del documento restano della company madre — questa
 * colonna serve solo a sapere a colpo d'occhio di quale sede si tratta.
 * Mostra "—" quando nessuna sede è collegata (1:1 / documenti pre-multi-sede).
 */
export function SedeCell({ doc }: { doc: Parameters<typeof resolveSedeRiferimento>[0] }) {
  const sede = resolveSedeRiferimento(doc);
  if (!sede) return <span className="text-pv-slate-400">—</span>;
  const loc = [sede.citta, sede.provincia ? `(${sede.provincia})` : ''].filter(Boolean).join(' ');
  return (
    <span title={loc || undefined} className="text-pv-slate-700">
      {sede.nome}
    </span>
  );
}
