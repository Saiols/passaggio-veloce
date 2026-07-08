import type { SedeScope } from '@/lib/sedi/scope-filters';

/**
 * Chi può leggere/scaricare una pratica.
 *
 * Company: broker o agenzia assegnata. Sede: la sede DEL LATO con cui combaci
 * (se sei il broker conta `brokerSedeId`, se sei l'agenzia conta `agenziaSedeId`),
 * mai quella della controparte. Nessun bypass per la vista aggregata: `scopeIds`
 * del proprietario contiene già tutte le sue sedi, e la pagina /pratiche/[id]
 * filtra allo stesso modo — un bypass renderebbe il download più permissivo
 * della pagina.
 *
 * Stessa semantica di `wherePraticaAttiva` (scope-filters.ts), che scopa lo zip
 * bulk `/api/pratiche/documenti-zip`: download singolo e bulk concedono ora lo
 * stesso insieme di pratiche. Conseguenza voluta: le pratiche legacy con sede
 * NULL non sono scaricabili da nessun non-admin, esattamente come non compaiono
 * né nella lista `/pratiche` né nel dettaglio.
 *
 * I campi sede sono OBBLIGATORI: un `select` che li dimentica deve rompere la
 * compilazione, non negare (o concedere) in silenzio.
 */
export function canAccessPratica(
  pratica: {
    brokerId: string;
    brokerSedeId: string | null;
    agenziaAssegnataId: string | null;
    agenziaSedeId: string | null;
  },
  viewer: { companyId: string | undefined; isAdminPiattaforma: boolean; scope: SedeScope },
): boolean {
  if (viewer.isAdminPiattaforma) return true;
  const cid = viewer.companyId;
  if (!cid) return false;

  // Fail-closed: `scopeIds` vuoto ⇒ nessuna sede rivendicabile ⇒ nessun accesso,
  // anche per il proprietario.
  const inScope = (sedeId: string | null): boolean =>
    sedeId != null && viewer.scope.scopeIds.includes(sedeId);

  // La sede va confrontata col lato con cui la company combacia: un broker non
  // guadagna accesso perché `agenziaSedeId` è per caso nel suo scope (non può
  // esserlo — gli id sede sono univoci e legati al `type` della company — ma la
  // regola resta esplicita e non dipende da quell'invariante).
  return (
    (pratica.brokerId === cid && inScope(pratica.brokerSedeId)) ||
    (pratica.agenziaAssegnataId === cid && inScope(pratica.agenziaSedeId))
  );
}

/**
 * Chi può scaricare un `Documento` (tabella documenti, non fatture).
 *
 * Due famiglie di documenti, due regole:
 *
 * 1. **Documento aziendale** (`companyId` valorizzato, nessuna pratica): visura
 *    camerale e carta d'identità del legale rappresentante, caricati in
 *    registrazione. Appartengono alla MADRE, non a una filiale: nessuna sede può
 *    rivendicarli ⇒ li vede il SOLO proprietario, in qualunque vista
 *    (`scope.isOwner`, mai `scope.aggregate`). Stesso principio dei documenti
 *    fiscali senza sede (`canViewDocumentoFiscale`). Senza questo gate un
 *    OPERATORE che indovina l'UUID scarica la carta d'identità
 *    dell'amministratore.
 * 2. **Documento di pratica**: stessa regola della pratica che lo contiene,
 *    delegata a `canAccessPratica` (company del lato + sede di quel lato).
 *
 * Tutto il resto è negato: un documento aziendale di un'ALTRA company non è mai
 * accessibile (il confronto `companyId === viewer.companyId` è la sola porta),
 * e un documento senza company né pratica non ha nessuno che possa rivendicarlo.
 *
 * I campi sono OBBLIGATORI (anche quando valgono `null`): un `select` che
 * dimentica `praticaId` o le sedi della pratica deve rompere la compilazione,
 * non concedere/negare in silenzio.
 */
export function canAccessDocumento(
  doc: {
    companyId: string | null;
    praticaId: string | null;
    pratica: {
      brokerId: string;
      brokerSedeId: string | null;
      agenziaAssegnataId: string | null;
      agenziaSedeId: string | null;
    } | null;
  },
  viewer: { companyId: string | undefined; isAdminPiattaforma: boolean; scope: SedeScope },
): boolean {
  if (viewer.isAdminPiattaforma) return true;

  // `companyId != null` esplicito: un documento con `companyId` null e un viewer
  // senza company non devono "combaciare" per confronto tra assenze.
  const documentoAziendale =
    doc.companyId != null && doc.companyId === viewer.companyId && doc.praticaId == null;
  if (documentoAziendale) return viewer.scope.isOwner;

  if (doc.pratica != null) return canAccessPratica(doc.pratica, viewer);
  return false;
}
