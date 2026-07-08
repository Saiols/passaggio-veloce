import type { SedeScope } from '@/lib/sedi/scope-filters';

/**
 * Chi può vedere un documento fiscale.
 *
 * Company: emittente o destinatario. Sede: il documento appartiene alla sede
 * che ha generato la pratica, oppure al wallet del payout. I documenti senza
 * nessuno dei due agganci (es. note di variazione slegate) sono visibili solo
 * al proprietario in vista aggregata: nessuna sede può rivendicarli.
 *
 * Logica pura condivisa tra il dettaglio fattura (gate di accesso), le route
 * di download (pdf/xml/zip) e l'elenco "Documenti fiscali" della pratica
 * (filtro dei link mostrati), così un broker non vede/clicca fatture non sue
 * (es. la FATTURA_PV PV→agenzia della propria pratica, che altrimenti
 * darebbe 404) e un ADMIN_SEDE non scarica indovinando l'ID la fattura di
 * un'altra sede della stessa madre.
 */
export function canViewDocumentoFiscale(
  doc: {
    emittenteCompanyId: string | null;
    destinatarioCompanyId: string | null;
    praticaAgenziaSedeId?: string | null;
    praticaBrokerSedeId?: string | null;
    payoutWalletSedeId?: string | null;
  },
  viewer: {
    companyId: string | null | undefined;
    isAdminPiattaforma: boolean;
    scope: SedeScope;
  },
): boolean {
  if (viewer.isAdminPiattaforma) return true;
  const cid = viewer.companyId;
  if (!cid) return false;

  const inCompany = doc.emittenteCompanyId === cid || doc.destinatarioCompanyId === cid;
  if (!inCompany) return false;
  if (viewer.scope.aggregate) return true;

  const sedi = viewer.scope.scopeIds;
  return (
    (doc.praticaAgenziaSedeId != null && sedi.includes(doc.praticaAgenziaSedeId)) ||
    (doc.praticaBrokerSedeId != null && sedi.includes(doc.praticaBrokerSedeId)) ||
    (doc.payoutWalletSedeId != null && sedi.includes(doc.payoutWalletSedeId))
  );
}
