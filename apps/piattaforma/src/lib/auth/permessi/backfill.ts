import { conDipendenze, permessiPerTipo, type CompanyTypeP, type Permesso } from './catalogo';

/**
 * Permessi da assegnare agli utenti che esistevano prima dell'introduzione del
 * sistema: fotografano ciò che potevano fare, con UNA restrizione voluta —
 * `pagamenti.iban` e `pagamenti.ritenta` non vanno agli operatori. Prima il gate
 * era il solo `companyType === 'AGENZIA'` (blocco-pagamento/actions.ts), quindi
 * qualunque operatore poteva cambiare l'IBAN dell'azienda.
 */
const OPERATORE: Record<CompanyTypeP, Permesso[]> = {
  DEALER: [
    'pratiche.view',
    'pratiche.create',
    'pratiche.annulla',
    'pratiche.valuta',
    'pratiche.download',
    'fatture.view',
    'fatture.download',
    'fatture.xml',
    'wallet.view',
    'affiliazione.view',
    'notifiche.view',
  ],
  AGENZIA: [
    'pratiche.view',
    'pratiche.processa',
    'pratiche.firma',
    'pratiche.segnala',
    'pratiche.download',
    'inbox.view',
    'inbox.gestisci',
    'fatture.view',
    'fatture.download',
    'fatture.xml',
    'wallet.view',
    'addebiti.view',
    'affiliazione.view',
    'feedback.view',
    'orari.view',
    'notifiche.view',
  ],
};

export function permessiBackfill(
  t: CompanyTypeP,
  ruoloSede: 'ADMIN_SEDE' | 'OPERATORE',
): Permesso[] {
  if (ruoloSede === 'ADMIN_SEDE') return permessiPerTipo(t);
  return conDipendenze(OPERATORE[t]);
}
