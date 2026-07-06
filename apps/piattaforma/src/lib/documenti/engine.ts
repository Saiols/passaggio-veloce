/**
 * Engine documentale — Schema Documentale v7 (SD-A release 2026-05).
 * Spec: docs/schema-documentale-v7.md
 *
 * Pure function: nessun side-effect, nessun accesso DB, completamente
 * deterministica e testabile. Riceve i campi compilati dal broker durante
 * il wizard e ritorna l'esito documentale (OK con lista documenti
 * richiesti, BLOCCO con motivo, REVISIONE_MANUALE con motivo).
 *
 * Albero decisionale:
 *  - Lato VENDITORE: anno immatricolazione, tipo soggetto,
 *    flag procura, flag successione
 *  - Lato ACQUIRENTE: tipo soggetto, flag minore
 *
 * Nota: il comodato d'uso NON è più ostativo (non genera BLOCCO). La validità
 * temporale di visura/permesso e la corrispondenza documenti↔soggetto sono
 * verificate via OCR nello step parte (lib/kyc/parte-docs), non qui.
 */

export type TipoSoggetto =
  | 'PRIVATO_ITALIANO'
  | 'STRANIERO_EXTRA_UE'
  | 'AZIENDA'
  | 'OPERATORE_AUTO';

/** Variante della carta d'identità (rilevante solo per il privato con CI): la
 *  CIE elettronica contiene già il codice fiscale, la cartacea no. */
export type CiTipo = 'CARTACEA' | 'ELETTRONICA';

export type DocumentoTipoEngine =
  | 'LIBRETTO_CIRCOLAZIONE'
  | 'CI_FRONTE'
  | 'CI_RETRO'
  | 'CODICE_FISCALE'
  | 'CODICE_FISCALE_RETRO'
  | 'PROCURA'
  | 'PERMESSO_SOGGIORNO'
  | 'VISURA_CAMERALE'
  | 'CERTIFICATO_PROPRIETA'
  | 'REVOCA_COMODATO'
  | 'CERTIFICATO_MORTE'
  | 'ATTO_ACCETTAZIONE_EREDITA'
  | 'DICHIARAZIONE_QUALITA_EREDE'
  | 'AUTORIZZAZIONE_TUTORE'
  | 'PASSAPORTO'
  | 'PATENTE'
  | 'PATENTE_RETRO'
  | 'LIBRETTO_CIRCOLAZIONE_RETRO';

export type ParteDocumento =
  | 'VEICOLO'
  | 'VENDITORE'
  | 'ACQUIRENTE'
  | 'PROCURATORE'
  | 'EREDE'
  | 'TUTORE'
  | 'AMMINISTRATORE_VENDITORE'
  | 'AMMINISTRATORE_ACQUIRENTE';

export type DocumentoRichiesto = {
  tipo: DocumentoTipoEngine;
  parte: ParteDocumento;
  motivo: string;
  veicoloOrdine?: number;
  venditoreOrdine?: number;
};

export type SchemaDocumentaleInput = {
  veicoli: { ordine: number; preImm2015: boolean; flagComodatoDuso: boolean }[];

  venditori: {
    ordine: number;
    tipoSoggetto: TipoSoggetto | null;
    documentoIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE';
    /** Variante CI (solo privato); default elettronica se non specificata. */
    ciTipo?: CiTipo | null;
  }[];
  flagProcura: boolean;
  flagSuccessione: boolean;

  acquirenteTipoSoggetto: TipoSoggetto | null;
  acquirenteDocumentoIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE';
  acquirenteCiTipo?: CiTipo | null;
  flagMinore: boolean;

  /** Data di riferimento per i calcoli scadenza. Default: now. */
  now?: Date;
};

export type EsitoSchemaDocumentale =
  | { kind: 'OK'; documentiRichiesti: DocumentoRichiesto[] }
  | { kind: 'BLOCCO'; motivo: string; soluzione: string }
  | { kind: 'INPUT_INCOMPLETO'; mancanti: string[] };

/**
 * Vero se l'identificazione avviene con CI elettronica (CIE), che contiene già
 * il codice fiscale. Privato: dipende dalla variante CI scelta (default
 * elettronica). Azienda/operatore: la CI del legale rappresentante è trattata
 * come elettronica. Straniero: usa passaporto/permesso, mai CIE.
 */
export function ciElettronica(
  tipoSoggetto: TipoSoggetto,
  ciTipo: CiTipo | null | undefined,
): boolean {
  if (tipoSoggetto === 'AZIENDA' || tipoSoggetto === 'OPERATORE_AUTO') return true;
  if (tipoSoggetto === 'PRIVATO_ITALIANO') return (ciTipo ?? 'ELETTRONICA') === 'ELETTRONICA';
  return false;
}

/**
 * Regola unica tessera sanitaria / codice fiscale: richiesto SEMPRE tranne
 * quando il documento è una CI ELETTRONICA (la CIE contiene già il CF). Vale
 * per passaporto/patente di qualsiasi soggetto e per la CI cartacea. Single
 * source of truth condivisa con lib/kyc/parte-docs.
 */
export function richiedeCodiceFiscale(
  docIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE',
  ciElett: boolean,
): boolean {
  return !(docIdentita === 'CI' && ciElett);
}

function emettiIdentita(
  out: DocumentoRichiesto[],
  parte: ParteDocumento,
  motivoPrefix: string,
  ciElett: boolean,
  docIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE',
  venditoreOrdine?: number,
): void {
  if (docIdentita === 'PASSAPORTO') {
    out.push({ tipo: 'PASSAPORTO', parte, motivo: `${motivoPrefix}: passaporto`, venditoreOrdine });
  } else if (docIdentita === 'PATENTE') {
    out.push({ tipo: 'PATENTE', parte, motivo: `${motivoPrefix}: patente fronte`, venditoreOrdine });
    out.push({ tipo: 'PATENTE_RETRO', parte, motivo: `${motivoPrefix}: patente retro`, venditoreOrdine });
  } else {
    out.push({ tipo: 'CI_FRONTE', parte, motivo: `${motivoPrefix}: CI fronte`, venditoreOrdine });
    out.push({ tipo: 'CI_RETRO', parte, motivo: `${motivoPrefix}: CI retro`, venditoreOrdine });
  }
  if (richiedeCodiceFiscale(docIdentita, ciElett)) {
    out.push({
      tipo: 'CODICE_FISCALE',
      parte,
      motivo: `${motivoPrefix}: tessera sanitaria / codice fiscale`,
      venditoreOrdine,
    });
  }
}

function aggiungiDocumentiPersona(
  out: DocumentoRichiesto[],
  parteCI: ParteDocumento,
  parteAmministratore: ParteDocumento,
  tipo: TipoSoggetto,
  ciTipo: CiTipo | null | undefined,
  motivoPrefix: string,
  docIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE',
  venditoreOrdine?: number,
): void {
  if (tipo === 'PRIVATO_ITALIANO') {
    emettiIdentita(out, parteCI, motivoPrefix, ciElettronica(tipo, ciTipo), docIdentita, venditoreOrdine);
    return;
  }
  if (tipo === 'STRANIERO_EXTRA_UE') {
    emettiIdentita(out, parteCI, motivoPrefix, false, docIdentita, venditoreOrdine);
    out.push({
      tipo: 'PERMESSO_SOGGIORNO',
      parte: parteCI,
      motivo: `${motivoPrefix}: permesso di soggiorno in corso di validità`,
      venditoreOrdine,
    });
    return;
  }
  if (tipo === 'AZIENDA' || tipo === 'OPERATORE_AUTO') {
    out.push({
      tipo: 'VISURA_CAMERALE',
      parte: parteCI,
      motivo: `${motivoPrefix}: visura camerale rilasciata negli ultimi 6 mesi`,
      venditoreOrdine,
    });
    // La CI del legale rappresentante è trattata come elettronica (niente CF).
    emettiIdentita(out, parteAmministratore, motivoPrefix, true, docIdentita, venditoreOrdine);
  }
}

export function calcolaDocumentiRichiesti(
  input: SchemaDocumentaleInput,
): EsitoSchemaDocumentale {
  // 0. Input minimi: tipo soggetto di ogni venditore + acquirente
  const mancanti: string[] = [];
  if (input.venditori.some((v) => !v.tipoSoggetto)) {
    mancanti.push('venditoreTipoSoggetto');
  }
  if (!input.acquirenteTipoSoggetto) mancanti.push('acquirenteTipoSoggetto');
  if (mancanti.length > 0) {
    return { kind: 'INPUT_INCOMPLETO', mancanti };
  }

  // Nota: il comodato d'uso non è più ostativo. La validità temporale di visura
  // (≤6 mesi) e permesso (non scaduto) e la corrispondenza dei documenti col
  // soggetto sono verificate nello step parte via OCR (lib/kyc/parte-docs), non
  // qui da date inserite a mano. L'engine emette solo la lista documenti.

  // Costruzione lista documenti richiesti
  const out: DocumentoRichiesto[] = [];

  // Per ogni veicolo: libretto (sempre) + CdP se pre-2015
  for (const v of input.veicoli) {
    out.push({
      tipo: 'LIBRETTO_CIRCOLAZIONE', parte: 'VEICOLO', veicoloOrdine: v.ordine,
      motivo: `Libretto di circolazione veicolo ${v.ordine} (sempre obbligatorio)`,
    });
    if (v.preImm2015) {
      out.push({
        tipo: 'CERTIFICATO_PROPRIETA', parte: 'VEICOLO', veicoloOrdine: v.ordine,
        motivo: `Veicolo ${v.ordine} immatricolato pre-2015: serve CdP`,
      });
    }
  }

  // Documenti venditore (uno per ciascun co-intestatario)
  for (const v of input.venditori) {
    aggiungiDocumentiPersona(
      out,
      'VENDITORE',
      'AMMINISTRATORE_VENDITORE',
      v.tipoSoggetto!,
      v.ciTipo,
      'Venditore',
      v.documentoIdentita,
      v.ordine,
    );
  }

  // Procura: doc procuratore + atto + CI venditore originale
  if (input.flagProcura) {
    out.push({
      tipo: 'PROCURA',
      parte: 'PROCURATORE',
      motivo: 'Vendita tramite procuratore: atto procura notarile',
    });
    out.push({
      tipo: 'CI_FRONTE',
      parte: 'PROCURATORE',
      motivo: 'Vendita tramite procuratore: CI procuratore fronte',
    });
    out.push({
      tipo: 'CI_RETRO',
      parte: 'PROCURATORE',
      motivo: 'Vendita tramite procuratore: CI procuratore retro',
    });
    // Nota: i documenti del venditore originale sono già stati aggiunti sopra,
    // l'engine non duplica. Lo schema PDF chiede esplicitamente "CI venditore
    // originale F+R" che combaciamo con i documenti standard del venditore.
  }

  // Successione: certificato morte + atto eredità + dichiarazione qualità
  // erede + CI erede. In questo flusso il venditore è l'erede, quindi la
  // sua CI è già richiesta dalla logica standard. Aggiungiamo solo i 3 doc
  // documentali specifici.
  if (input.flagSuccessione) {
    out.push({
      tipo: 'CERTIFICATO_MORTE',
      parte: 'EREDE',
      motivo: 'Successione ereditaria: certificato di morte del proprietario',
    });
    out.push({
      tipo: 'ATTO_ACCETTAZIONE_EREDITA',
      parte: 'EREDE',
      motivo: 'Successione ereditaria: atto di accettazione eredità',
    });
    out.push({
      tipo: 'DICHIARAZIONE_QUALITA_EREDE',
      parte: 'EREDE',
      motivo: 'Successione ereditaria: dichiarazione qualità di erede',
    });
  }

  // Documenti acquirente
  aggiungiDocumentiPersona(
    out,
    'ACQUIRENTE',
    'AMMINISTRATORE_ACQUIRENTE',
    input.acquirenteTipoSoggetto!,
    input.acquirenteCiTipo,
    'Acquirente',
    input.acquirenteDocumentoIdentita,
  );

  // Compratore minorenne: + autorizzazione tutore + CI tutore
  if (input.flagMinore) {
    out.push({
      tipo: 'AUTORIZZAZIONE_TUTORE',
      parte: 'TUTORE',
      motivo: 'Compratore minorenne: autorizzazione del tutore legale',
    });
    out.push({
      tipo: 'CI_FRONTE',
      parte: 'TUTORE',
      motivo: 'Compratore minorenne: CI tutore fronte',
    });
    out.push({
      tipo: 'CI_RETRO',
      parte: 'TUTORE',
      motivo: 'Compratore minorenne: CI tutore retro',
    });
  }

  return { kind: 'OK', documentiRichiesti: out };
}
