/**
 * Chi può vedere un DocumentoFiscale: l'admin di piattaforma, oppure la company
 * emittente o destinataria del documento. Logica pura condivisa tra il dettaglio
 * fattura (gate di accesso) e l'elenco "Documenti fiscali" della pratica (filtro
 * dei link mostrati), così un broker non vede/clicca fatture non sue (es. la
 * FATTURA_PV PV→agenzia della propria pratica, che altrimenti darebbe 404).
 */
export function canViewDocumentoFiscale(
  doc: { emittenteCompanyId: string | null; destinatarioCompanyId: string | null },
  viewer: { companyId: string | null | undefined; isAdminPiattaforma: boolean },
): boolean {
  if (viewer.isAdminPiattaforma) return true;
  const cid = viewer.companyId;
  if (!cid) return false;
  return doc.emittenteCompanyId === cid || doc.destinatarioCompanyId === cid;
}
