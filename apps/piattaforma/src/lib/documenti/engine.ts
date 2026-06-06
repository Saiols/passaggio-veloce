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
 *  - Lato VENDITORE: anno immatricolazione, comodato, tipo soggetto,
 *    flag procura, flag successione
 *  - Lato ACQUIRENTE: tipo soggetto, flag minore
 *  - BLOCCHI: comodato attivo (revoca PRA), permesso scaduto, visura
 *    azienda > 6 mesi
 */

export type TipoSoggetto =
  | 'PRIVATO_ITALIANO_CIE'
  | 'PRIVATO_ITALIANO_CARTACEA'
  | 'STRANIERO_EXTRA_UE'
  | 'AZIENDA'
  | 'OPERATORE_AUTO';

export type DocumentoTipoEngine =
  | 'LIBRETTO_CIRCOLAZIONE'
  | 'CI_FRONTE'
  | 'CI_RETRO'
  | 'CODICE_FISCALE'
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
  | 'PATENTE';

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

  venditoreTipoSoggetto: TipoSoggetto | null;
  venditoreVisuraData: Date | null;
  venditorePermessoData: Date | null;
  venditoreDocumentoIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE';
  flagProcura: boolean;
  flagSuccessione: boolean;

  acquirenteTipoSoggetto: TipoSoggetto | null;
  acquirenteVisuraData: Date | null;
  acquirentePermessoData: Date | null;
  acquirenteDocumentoIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE';
  flagMinore: boolean;

  /** Data di riferimento per i calcoli scadenza. Default: now. */
  now?: Date;
};

export type EsitoSchemaDocumentale =
  | { kind: 'OK'; documentiRichiesti: DocumentoRichiesto[] }
  | { kind: 'BLOCCO'; motivo: string; soluzione: string }
  | { kind: 'INPUT_INCOMPLETO'; mancanti: string[] };

const VISURA_VALIDITA_MESI = 6;

/**
 * Verifica se la data del permesso di soggiorno è ancora valida (non
 * scaduta) alla data di riferimento. Null = non compilato.
 */
function permessoValido(permessoData: Date | null, now: Date): boolean {
  if (!permessoData) return false;
  return permessoData.getTime() >= now.getTime();
}

/**
 * Verifica se la visura camerale è "fresca" (≤ 6 mesi dalla data di
 * rilascio). Null = non compilato. Useremo una soglia in MESI calendari.
 */
function visuraFresca(visuraData: Date | null, now: Date): boolean {
  if (!visuraData) return false;
  const limite = new Date(now);
  limite.setMonth(limite.getMonth() - VISURA_VALIDITA_MESI);
  return visuraData.getTime() >= limite.getTime();
}

function emettiIdentita(
  out: DocumentoRichiesto[],
  parte: ParteDocumento,
  motivoPrefix: string,
  tipoSoggetto: TipoSoggetto,
  docIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE',
): void {
  if (docIdentita === 'PASSAPORTO') {
    out.push({ tipo: 'PASSAPORTO', parte, motivo: `${motivoPrefix}: passaporto` });
    return;
  }
  if (docIdentita === 'PATENTE') {
    out.push({ tipo: 'PATENTE', parte, motivo: `${motivoPrefix}: patente` });
    return;
  }
  out.push({ tipo: 'CI_FRONTE', parte, motivo: `${motivoPrefix}: CI fronte` });
  out.push({ tipo: 'CI_RETRO', parte, motivo: `${motivoPrefix}: CI retro` });
  if (tipoSoggetto === 'PRIVATO_ITALIANO_CARTACEA') {
    out.push({ tipo: 'CODICE_FISCALE', parte, motivo: `${motivoPrefix}: tessera CF` });
  }
}

function aggiungiDocumentiPersona(
  out: DocumentoRichiesto[],
  parteCI: ParteDocumento,
  parteAmministratore: ParteDocumento,
  tipo: TipoSoggetto,
  motivoPrefix: string,
  docIdentita: 'CI' | 'PASSAPORTO' | 'PATENTE',
): void {
  if (tipo === 'PRIVATO_ITALIANO_CIE' || tipo === 'PRIVATO_ITALIANO_CARTACEA') {
    emettiIdentita(out, parteCI, motivoPrefix, tipo, docIdentita);
    return;
  }
  if (tipo === 'STRANIERO_EXTRA_UE') {
    emettiIdentita(out, parteCI, motivoPrefix, tipo, docIdentita);
    out.push({
      tipo: 'PERMESSO_SOGGIORNO',
      parte: parteCI,
      motivo: `${motivoPrefix}: permesso di soggiorno in corso di validità`,
    });
    return;
  }
  if (tipo === 'AZIENDA' || tipo === 'OPERATORE_AUTO') {
    out.push({
      tipo: 'VISURA_CAMERALE',
      parte: parteCI,
      motivo: `${motivoPrefix}: visura camerale rilasciata negli ultimi 6 mesi`,
    });
    emettiIdentita(out, parteAmministratore, motivoPrefix, 'PRIVATO_ITALIANO_CIE', docIdentita);
  }
}

export function calcolaDocumentiRichiesti(
  input: SchemaDocumentaleInput,
): EsitoSchemaDocumentale {
  const now = input.now ?? new Date();

  // 0. Input minimi: tipo soggetto venditore + acquirente
  const mancanti: string[] = [];
  if (!input.venditoreTipoSoggetto) mancanti.push('venditoreTipoSoggetto');
  if (!input.acquirenteTipoSoggetto) mancanti.push('acquirenteTipoSoggetto');
  if (mancanti.length > 0) {
    return { kind: 'INPUT_INCOMPLETO', mancanti };
  }

  // 1. BLOCCHI immediati
  if (input.veicoli.some((v) => v.flagComodatoDuso)) {
    return {
      kind: 'BLOCCO',
      motivo: 'Comodato d\'uso attivo sul veicolo',
      soluzione:
        'Il comodato deve essere revocato al PRA prima del passaggio. Riprovare dopo la revoca.',
    };
  }
  if (
    input.venditoreTipoSoggetto === 'STRANIERO_EXTRA_UE' &&
    !permessoValido(input.venditorePermessoData, now)
  ) {
    return {
      kind: 'BLOCCO',
      motivo: 'Permesso di soggiorno del venditore scaduto o mancante',
      soluzione:
        'Il venditore deve essere in possesso di permesso di soggiorno in corso di validità.',
    };
  }
  if (
    input.acquirenteTipoSoggetto === 'STRANIERO_EXTRA_UE' &&
    !permessoValido(input.acquirentePermessoData, now)
  ) {
    return {
      kind: 'BLOCCO',
      motivo: 'Permesso di soggiorno dell\'acquirente scaduto o mancante',
      soluzione:
        'L\'acquirente deve essere in possesso di permesso di soggiorno in corso di validità.',
    };
  }
  if (
    (input.venditoreTipoSoggetto === 'AZIENDA' ||
      input.venditoreTipoSoggetto === 'OPERATORE_AUTO') &&
    !visuraFresca(input.venditoreVisuraData, now)
  ) {
    return {
      kind: 'BLOCCO',
      motivo: 'Visura camerale del venditore non fresca (>6 mesi o assente)',
      soluzione:
        'Servono visure camerali rilasciate negli ultimi 6 mesi. Richiedere una nuova visura.',
    };
  }
  if (
    (input.acquirenteTipoSoggetto === 'AZIENDA' ||
      input.acquirenteTipoSoggetto === 'OPERATORE_AUTO') &&
    !visuraFresca(input.acquirenteVisuraData, now)
  ) {
    return {
      kind: 'BLOCCO',
      motivo: 'Visura camerale dell\'acquirente non fresca (>6 mesi o assente)',
      soluzione:
        'Servono visure camerali rilasciate negli ultimi 6 mesi. Richiedere una nuova visura.',
    };
  }

  // 2. Costruzione lista documenti richiesti
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

  // Documenti venditore
  aggiungiDocumentiPersona(
    out,
    'VENDITORE',
    'AMMINISTRATORE_VENDITORE',
    input.venditoreTipoSoggetto!,
    'Venditore',
    input.venditoreDocumentoIdentita,
  );

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
