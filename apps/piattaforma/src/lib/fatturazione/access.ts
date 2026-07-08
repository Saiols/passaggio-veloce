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
  // `some` è role-agnostic: matcha `sedi` contro TUTTI e tre i campi (agenzia,
  // broker, wallet), mentre `whereDocumentoFiscale` (scope-filters.ts) filtra
  // solo il campo del ruolo del viewer (agenziaSedeId per AGENZIA, brokerSedeId
  // per DEALER). Qui è comunque corretto — non un allargamento — perché lo
  // `scopeIds` del viewer contiene solo id di sedi della PROPRIA company e gli
  // id sede sono univoci e vincolati al `type` della company: una sede AGENZIA
  // non può mai comparire nello scope di un DEALER (e viceversa), quindi il
  // campo "dell'altro ruolo" nel documento non potrà mai matchare `sedi`.
  // Si romperebbe se in futuro una company potesse avere sedi di tipo diverso
  // dal proprio, o se gli id sede smettessero di essere globalmente univoci:
  // in quel caso questo `some` diventerebbe un superset reale della lista.
  return docSedi.some((s) => s != null && sedi.includes(s));
}

/**
 * Estrae i campi che `canViewDocumentoFiscale` legge da un documento con le
 * relazioni caricate.
 *
 * `pratica` e `payout` sono OBBLIGATORI (possono valere `null`, ma la chiave
 * deve esistere nel tipo): se fossero opzionali, un chiamante il cui
 * `select`/`include` dimentica di caricare la relazione compilerebbe lo
 * stesso, l'helper restituirebbe in silenzio `null` per quel campo, e
 * `canViewDocumentoFiscale` classificherebbe il documento come "senza
 * sede" — con la regola attuale questo NON nega l'accesso ma lo CONCEDE
 * a qualunque owner in vista su singola sede (silent grant), invece di
 * far fallire il typecheck. `payout.wallet` non ha `| null`: `Payout.walletId`
 * è una FK non-null nello schema, quindi quando `payout` esiste `wallet`
 * esiste sempre.
 */
export function docSedeFields(doc: {
  emittenteCompanyId: string | null;
  destinatarioCompanyId: string | null;
  pratica: { agenziaSedeId: string | null; brokerSedeId: string | null } | null;
  payout: { wallet: { sedeId: string | null } } | null;
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
    payoutWalletSedeId: doc.payout?.wallet.sedeId ?? null,
  };
}
