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
