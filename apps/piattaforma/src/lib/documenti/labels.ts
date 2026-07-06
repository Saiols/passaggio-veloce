import type { DocumentoOwner, DocumentoTipo } from '@pv/db';
import { appendToFilename } from './filename';

/**
 * Mappa unica DocumentoTipo → etichetta leggibile, usata sia per il nome dei
 * file scaricati/zip sia (potenzialmente) in UI. `Record` completo: aggiungere
 * un valore all'enum forza a mapparlo qui (errore di compilazione altrimenti).
 */
const TIPO_LABEL: Record<DocumentoTipo, string> = {
  LIBRETTO_CIRCOLAZIONE: 'Libretto circolazione',
  CI_FRONTE: 'CI fronte',
  CI_RETRO: 'CI retro',
  CODICE_FISCALE: 'Codice fiscale (fronte)',
  CODICE_FISCALE_RETRO: 'Codice fiscale (retro)',
  PROCURA: 'Procura',
  PERMESSO_SOGGIORNO: 'Permesso di soggiorno',
  VISURA_CAMERALE: 'Visura camerale',
  CERTIFICATO_PROPRIETA: 'Certificato di proprietà',
  REVOCA_COMODATO: 'Revoca comodato',
  CERTIFICATO_MORTE: 'Certificato di morte',
  ATTO_ACCETTAZIONE_EREDITA: 'Atto di accettazione eredità',
  DICHIARAZIONE_QUALITA_EREDE: 'Dichiarazione qualità di erede',
  AUTORIZZAZIONE_TUTORE: 'Autorizzazione del tutore',
  ALTRO: 'Altro',
  PASSAPORTO: 'Passaporto',
  PATENTE: 'Patente (fronte)',
  PATENTE_RETRO: 'Patente (retro)',
  LIBRETTO_CIRCOLAZIONE_RETRO: 'Libretto (retro)',
  FOGLIO_COMPLEMENTARE: 'Foglio complementare',
  DELEGA_VENDITA: 'Procura a vendere',
  DOCUMENTO_DELEGATO: 'Documento delegato',
};

const OWNER_LABEL: Record<DocumentoOwner, string> = {
  VENDITORE: 'venditore',
  ACQUIRENTE: 'acquirente',
  AMMINISTRATORE: 'amministratore',
  AZIENDA: 'azienda',
};

export function labelDocumentoTipo(tipo: string): string {
  return TIPO_LABEL[tipo as DocumentoTipo] ?? tipo;
}

export function labelDocumentoOwner(owner: string | null | undefined): string {
  if (!owner) return '';
  return OWNER_LABEL[owner as DocumentoOwner] ?? owner;
}

/** Estensione (senza punto) dal filename originale; fallback "bin". */
function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return 'bin';
  return filename.slice(dot + 1).toLowerCase();
}

/**
 * Nome del file scaricato/nello zip: "<codicePratica> - <label>[ - <owner>]".
 * Sostituisce il nome file originale (privacy + rintracciabilità). `index`
 * (opzionale) garantisce l'unicità dentro uno zip con più documenti dello
 * stesso tipo/owner. L'estensione è preservata dal file originale.
 */
export function documentoDownloadName(
  doc: { tipo: string; owner: string | null; originalFilename: string },
  opts?: { codicePratica?: string | null; index?: number },
): string {
  const codice = opts?.codicePratica?.trim() || 'documento';
  const owner = labelDocumentoOwner(doc.owner);
  return appendToFilename(
    `${codice}.${extOf(doc.originalFilename)}`,
    labelDocumentoTipo(doc.tipo),
    owner || undefined,
    opts?.index != null ? String(opts.index + 1) : undefined,
  );
}
