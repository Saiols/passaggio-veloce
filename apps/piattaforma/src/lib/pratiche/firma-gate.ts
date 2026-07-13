import type { PraticaStato } from '@pv/db';

/** Il minimo che serve per decidere se una pratica può essere firmata. */
export type PraticaFirmabile = {
  stato: PraticaStato;
  flagSegnalata: boolean;
  agenziaAssegnataId: string | null;
};

/**
 * Gate COMUNI ai due percorsi di firma: quello dell'agenzia assegnata e quello
 * dell'attestazione da parte dell'admin. Puro: si testa senza auth né Prisma, e
 * i due chiamanti non possono divergere.
 *
 * NON contiene i gate specifici di un percorso (permesso `pratiche.firma`,
 * companyType, scope sede, blocco insoluti per l'agenzia; ruolo ADMIN e
 * motivazione per l'admin): quelli restano dove sono, perché non sono comuni.
 *
 * @returns null se la firma è ammessa, altrimenti il messaggio d'errore.
 */
export function motivoBloccoFirma(p: PraticaFirmabile): string | null {
  if (p.stato !== 'PROCESSATA') {
    return 'La pratica deve essere prima processata';
  }
  if (p.flagSegnalata) {
    return 'Pratica con segnalazione in verifica: non puoi firmarla finché il team non ha deciso.';
  }
  if (!p.agenziaAssegnataId) {
    return 'Pratica senza agenzia assegnata';
  }
  return null;
}
