import { formatCurrencyCent } from '@/lib/format';
import type { Tariffario } from '@/lib/pricing';

/**
 * Blocco testo autorevole coi prezzi correnti, iniettato nel system prompt
 * del chatbot (solo tier clients/internal). Prevale sugli importi nella KB.
 */
export function buildListinoBlock(t: Tariffario): string {
  const s = t.SEMPLICE;
  const m = t.MINIVOLTURA;
  return [
    'LISTINO UFFICIALE (fonte autorevole, aggiornato — prevale su qualsiasi importo presente nella knowledge base, incluse commissioni di affiliazione):',
    `- Passaggio SEMPLICE (acquirente privato): costo agenzia ${formatCurrencyCent(s.feeAgenziaCent)} per veicolo, compenso broker ${formatCurrencyCent(s.creditoBrokerCent)} per veicolo, commissione affiliazione ${formatCurrencyCent(s.affiliazioneCent)} per veicolo.`,
    `- Minivoltura (acquirente commerciante): costo agenzia ${formatCurrencyCent(m.feeAgenziaCent)} per veicolo, compenso broker ${formatCurrencyCent(m.creditoBrokerCent)} per veicolo, commissione affiliazione ${formatCurrencyCent(m.affiliazioneCent)} per veicolo.`,
  ].join('\n');
}
