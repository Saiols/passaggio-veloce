import type { DocumentoRichiesto, EsitoSchemaDocumentale, DocumentoTipoEngine, ParteDocumento } from './engine';

export function docKey(d: DocumentoRichiesto): string {
  return `${d.tipo}__${d.parte}__${d.veicoloOrdine ?? 0}__${d.venditoreOrdine ?? 0}`;
}

const TIPI_IDENTITA: ReadonlySet<string> = new Set([
  'LIBRETTO_CIRCOLAZIONE', 'CI_FRONTE', 'CI_RETRO', 'CODICE_FISCALE', 'PASSAPORTO', 'PATENTE', 'PERMESSO_SOGGIORNO',
]);

export function requiredUploadDocs(esito: EsitoSchemaDocumentale): DocumentoRichiesto[] {
  if (esito.kind !== 'OK') return [];
  return esito.documentiRichiesti.filter((d) => !TIPI_IDENTITA.has(d.tipo));
}

export function parteToOwner(parte: ParteDocumento): 'VENDITORE' | 'ACQUIRENTE' | null {
  if (parte === 'VENDITORE' || parte === 'AMMINISTRATORE_VENDITORE') return 'VENDITORE';
  if (parte === 'ACQUIRENTE' || parte === 'AMMINISTRATORE_ACQUIRENTE') return 'ACQUIRENTE';
  return null;
}

const TIPO_LABEL: Record<DocumentoTipoEngine, string> = {
  LIBRETTO_CIRCOLAZIONE: 'Libretto di circolazione',
  CI_FRONTE: "Carta d'identità (fronte)",
  CI_RETRO: "Carta d'identità (retro)",
  CODICE_FISCALE: 'Codice fiscale / Tessera sanitaria',
  PROCURA: 'Procura',
  PERMESSO_SOGGIORNO: 'Permesso di soggiorno',
  VISURA_CAMERALE: 'Visura camerale',
  CERTIFICATO_PROPRIETA: 'Certificato di Proprietà',
  REVOCA_COMODATO: 'Revoca comodato',
  CERTIFICATO_MORTE: 'Certificato di morte',
  ATTO_ACCETTAZIONE_EREDITA: 'Atto di accettazione eredità',
  DICHIARAZIONE_QUALITA_EREDE: 'Dichiarazione qualità di erede',
  AUTORIZZAZIONE_TUTORE: 'Autorizzazione del tutore',
  PASSAPORTO: 'Passaporto',
  PATENTE: 'Patente',
};

const PARTE_LABEL: Record<Exclude<ParteDocumento, 'VEICOLO'>, string> = {
  VENDITORE: 'Venditore',
  ACQUIRENTE: 'Acquirente',
  PROCURATORE: 'Procuratore',
  EREDE: 'Erede',
  TUTORE: 'Tutore',
  AMMINISTRATORE_VENDITORE: 'Amministratore (venditore)',
  AMMINISTRATORE_ACQUIRENTE: 'Amministratore (acquirente)',
};

export function docLabel(d: DocumentoRichiesto): string {
  const tipo = TIPO_LABEL[d.tipo];
  if (d.parte === 'VEICOLO') return `${tipo} — Veicolo ${d.veicoloOrdine ?? 1}`;
  const parteLbl = PARTE_LABEL[d.parte];
  if (
    d.venditoreOrdine !== undefined &&
    (d.parte === 'VENDITORE' || d.parte === 'AMMINISTRATORE_VENDITORE')
  ) {
    return `${tipo} — ${parteLbl} — Venditore ${d.venditoreOrdine}`;
  }
  return `${tipo} — ${parteLbl}`;
}
