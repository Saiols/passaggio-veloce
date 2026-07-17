/**
 * Sedi da escludere dalla selezione candidati (multi-sede, distribuzione):
 *  - tutte quelle già contattate NEL CICLO corrente (nessun doppio invio nello
 *    stesso giro);
 *  - tutte quelle con esito REVOCATA_ADMIN su questa pratica, in QUALUNQUE
 *    ciclo → esclusione PERMANENTE (l'admin le ha tolte la gestione).
 *
 * Per una pratica mai revocata (distribuzioneCiclo sempre 1, tutte le righe
 * ciclo 1) coincide esattamente con l'insieme storico "sedi già contattate":
 * comportamento invariato rispetto a prima del ciclo.
 */
export function sediDaEscludere(pratica: {
  distribuzioneCiclo: number;
  assegnazioni: { sedeId: string | null; ciclo: number; esito: string }[];
}): string[] {
  const out = new Set<string>();
  for (const a of pratica.assegnazioni) {
    if (a.sedeId == null) continue;
    if (a.ciclo === pratica.distribuzioneCiclo || a.esito === 'REVOCATA_ADMIN') {
      out.add(a.sedeId);
    }
  }
  return [...out];
}
