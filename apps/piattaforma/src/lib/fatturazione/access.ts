import type { SedeScope } from '@/lib/sedi/scope-filters';

/**
 * Chi può vedere un documento fiscale.
 *
 * Company: emittente o destinatario. Sede: il documento appartiene alla sede
 * che ha generato la pratica, oppure al wallet del payout. I documenti senza
 * nessuno dei due agganci (es. il DOC_BROKER del payout sul wallet della madre,
 * o una nota di variazione slegata) sono dell'entità legale: nessuna sede può
 * rivendicarli, quindi li vede solo il proprietario — in vista aggregata come
 * in vista su singola sede. Un membro di sede non li vede mai.
 *
 * Logica pura condivisa tra il dettaglio fattura (gate di accesso), le route
 * di download (pdf/xml/zip) e l'elenco "Documenti fiscali" della pratica
 * (filtro dei link mostrati), così un broker non vede/clicca fatture non sue
 * (es. la FATTURA_PV PV→agenzia della propria pratica, che altrimenti
 * darebbe 404) e un ADMIN_SEDE non scarica indovinando l'ID la fattura di
 * un'altra sede della stessa madre.
 *
 * I tre campi sede sono OBBLIGATORI (anche quando valgono `null`): renderli
 * opzionali farebbe compilare un chiamante che dimentica di caricare le
 * relazioni, negando poi l'accesso in silenzio a ogni non-owner.
 */
export function canViewDocumentoFiscale(
  doc: {
    emittenteCompanyId: string | null;
    destinatarioCompanyId: string | null;
    praticaAgenziaSedeId: string | null;
    praticaBrokerSedeId: string | null;
    payoutWalletSedeId: string | null;
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
  const docSedi = [doc.praticaAgenziaSedeId, doc.praticaBrokerSedeId, doc.payoutWalletSedeId];
  const senzaSede = docSedi.every((s) => s == null);
  // Documento non agganciato ad alcuna sede: è dell'entità legale, lo vede solo
  // il proprietario (in qualunque vista). Un membro di sede non lo vede mai.
  if (senzaSede) return viewer.scope.isOwner;
  return docSedi.some((s) => s != null && sedi.includes(s));
}

/** Estrae i campi che `canViewDocumentoFiscale` legge da un documento con le relazioni caricate. */
export function docSedeFields(doc: {
  emittenteCompanyId: string | null;
  destinatarioCompanyId: string | null;
  pratica?: { agenziaSedeId: string | null; brokerSedeId: string | null } | null;
  payout?: { wallet: { sedeId: string | null } | null } | null;
}): {
  emittenteCompanyId: string | null;
  destinatarioCompanyId: string | null;
  praticaAgenziaSedeId: string | null;
  praticaBrokerSedeId: string | null;
  payoutWalletSedeId: string | null;
} {
  return {
    emittenteCompanyId: doc.emittenteCompanyId,
    destinatarioCompanyId: doc.destinatarioCompanyId,
    praticaAgenziaSedeId: doc.pratica?.agenziaSedeId ?? null,
    praticaBrokerSedeId: doc.pratica?.brokerSedeId ?? null,
    payoutWalletSedeId: doc.payout?.wallet?.sedeId ?? null,
  };
}
