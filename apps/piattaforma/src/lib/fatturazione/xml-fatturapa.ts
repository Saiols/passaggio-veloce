/**
 * Generatore XML FatturaPA (formato FPR12, B2B privati) conforme alla struttura
 * XSD v1.2 dell'Agenzia delle Entrate. Funzione PURA: riceve i dati già risolti
 * (snapshot delle parti + importi) e produce la stringa XML, senza accesso al DB.
 *
 * Copre i casi di Passaggio Veloce:
 * - TD01 FATTURA_PV: PV (RF01) → agenzia, IVA 22% scorporata.
 * - TD01 DOC_BROKER ordinario: broker (RF01) → PV, per conto terzi (SoggettoEmittente TZ).
 * - TD06 DOC_BROKER forfettario: broker (RF19) → PV, fuori campo IVA (Natura N2.2).
 * - TD04 nota di credito: importi sempre positivi (il tipo documento segnala la rettifica).
 *
 * NOTA fiscale (da spot-check finale col commercialista — B1): per il forfettario
 * usiamo `Natura = N2.2` (operazioni non soggette, altri casi) e il riferimento
 * normativo alla L. 190/2014. Per il regime PRIVATO non si emette XML (ricevuta
 * non fiscale) e per la penale broker non si genera documento fiscale.
 */

/** Una parte fiscale (cedente/cessionario/terzo) già "congelata". */
export type FatturaPaParte = {
  denominazione: string;
  /** P.IVA (IdFiscaleIVA.IdCodice). null se la parte ha solo CF (non usato in pratica). */
  partitaIva: string | null;
  /** Codice fiscale (opzionale, emesso solo se valorizzato). */
  codiceFiscale?: string | null;
  /** RF01 (ordinario) / RF19 (forfettario). Obbligatorio sul CedentePrestatore. */
  regimeFiscale?: string;
  indirizzo: string;
  cap: string;
  comune: string;
  provincia: string;
  /** Default 'IT'. */
  nazione?: string;
  /** Solo per il cessionario: codice destinatario SDI (7 char). */
  codiceDestinatario?: string | null;
  /** Solo per il cessionario: PEC (usata se manca il codice SDI). */
  pec?: string | null;
};

export type FatturaPaInput = {
  tipoDocumento: 'TD01' | 'TD06' | 'TD04';
  /** Numero documento leggibile, es. "7/2026". */
  numero: string;
  /** Data emissione, formato 'YYYY-MM-DD'. */
  data: string;
  cedentePrestatore: FatturaPaParte;
  cessionarioCommittente: FatturaPaParte;
  /** Importi in centesimi. Per TD04 possono arrivare negativi: l'XML usa il valore assoluto. */
  imponibileCent: number;
  ivaCent: number;
  aliquotaIvaPct: number;
  /** Codice Natura quando l'aliquota è 0 (es. 'N2.2' per forfettario). */
  natura?: string | null;
  descrizione: string;
  causale?: string | null;
  /**
   * Quando il documento è emesso da PV PER CONTO del cedente (broker): i dati del
   * terzo emittente (PV). Genera <TerzoIntermediarioOSoggettoEmittente> + <SoggettoEmittente>TZ.
   */
  soggettoEmittenteTerzo?: FatturaPaParte | null;
  /** Progressivo invio (alfanumerico ≤ 10). */
  progressivoInvio: string;
  /** Soggetto che trasmette materialmente (PV). */
  idTrasmittente: { idPaese: string; idCodice: string };
};

const FORFETTARIO_RIF_NORMATIVO = 'Art. 1, commi 54-89, L. 190/2014 - regime forfettario';

/** Escape dei caratteri speciali XML. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Centesimi → importo a 2 decimali, sempre positivo (FatturaPA non ammette negativi). */
function eur(cents: number): string {
  return (Math.abs(cents) / 100).toFixed(2);
}

/** Percentuale → 2 decimali, es. 22 → "22.00". */
function pct(n: number): string {
  return n.toFixed(2);
}

/** <Sede> di una parte. */
function sede(p: FatturaPaParte): string {
  return [
    '<Sede>',
    `<Indirizzo>${esc(p.indirizzo)}</Indirizzo>`,
    `<CAP>${esc(p.cap)}</CAP>`,
    `<Comune>${esc(p.comune)}</Comune>`,
    p.provincia ? `<Provincia>${esc(p.provincia)}</Provincia>` : '',
    `<Nazione>${esc(p.nazione ?? 'IT')}</Nazione>`,
    '</Sede>',
  ]
    .filter(Boolean)
    .join('');
}

/** Blocco DatiAnagrafici (con RegimeFiscale solo per il cedente). */
function datiAnagrafici(p: FatturaPaParte, conRegime: boolean): string {
  const parts: string[] = ['<DatiAnagrafici>'];
  if (p.partitaIva) {
    parts.push(
      `<IdFiscaleIVA><IdPaese>${esc(p.nazione ?? 'IT')}</IdPaese><IdCodice>${esc(p.partitaIva)}</IdCodice></IdFiscaleIVA>`,
    );
  }
  if (p.codiceFiscale) {
    parts.push(`<CodiceFiscale>${esc(p.codiceFiscale)}</CodiceFiscale>`);
  }
  parts.push(`<Anagrafica><Denominazione>${esc(p.denominazione)}</Denominazione></Anagrafica>`);
  if (conRegime) {
    parts.push(`<RegimeFiscale>${esc(p.regimeFiscale ?? 'RF01')}</RegimeFiscale>`);
  }
  parts.push('</DatiAnagrafici>');
  return parts.join('');
}

/** <DatiTrasmissione> con CodiceDestinatario/PEC del cessionario. */
function datiTrasmissione(input: FatturaPaInput): string {
  const dest = input.cessionarioCommittente;
  const sdi = dest.codiceDestinatario?.trim();
  const usaSdi = Boolean(sdi);
  return [
    '<DatiTrasmissione>',
    `<IdTrasmittente><IdPaese>${esc(input.idTrasmittente.idPaese)}</IdPaese><IdCodice>${esc(input.idTrasmittente.idCodice)}</IdCodice></IdTrasmittente>`,
    `<ProgressivoInvio>${esc(input.progressivoInvio)}</ProgressivoInvio>`,
    '<FormatoTrasmissione>FPR12</FormatoTrasmissione>',
    `<CodiceDestinatario>${usaSdi ? esc(sdi as string) : '0000000'}</CodiceDestinatario>`,
    !usaSdi && dest.pec ? `<PECDestinatario>${esc(dest.pec)}</PECDestinatario>` : '',
    '</DatiTrasmissione>',
  ]
    .filter(Boolean)
    .join('');
}

function header(input: FatturaPaInput): string {
  const terzo = input.soggettoEmittenteTerzo;
  return [
    '<FatturaElettronicaHeader>',
    datiTrasmissione(input),
    '<CedentePrestatore>',
    datiAnagrafici(input.cedentePrestatore, true),
    sede(input.cedentePrestatore),
    '</CedentePrestatore>',
    '<CessionarioCommittente>',
    datiAnagrafici(input.cessionarioCommittente, false),
    sede(input.cessionarioCommittente),
    '</CessionarioCommittente>',
    terzo
      ? `<TerzoIntermediarioOSoggettoEmittente>${datiAnagrafici(terzo, false)}</TerzoIntermediarioOSoggettoEmittente>`
      : '',
    terzo ? '<SoggettoEmittente>TZ</SoggettoEmittente>' : '',
    '</FatturaElettronicaHeader>',
  ]
    .filter(Boolean)
    .join('');
}

function body(input: FatturaPaInput): string {
  const totale = eur(input.imponibileCent + input.ivaCent);
  const imponibile = eur(input.imponibileCent);
  const imposta = eur(input.ivaCent);
  const aliquota = pct(input.aliquotaIvaPct);
  const natura = input.natura ?? null;
  return [
    '<FatturaElettronicaBody>',
    '<DatiGenerali>',
    '<DatiGeneraliDocumento>',
    `<TipoDocumento>${input.tipoDocumento}</TipoDocumento>`,
    '<Divisa>EUR</Divisa>',
    `<Data>${input.data}</Data>`,
    `<Numero>${esc(input.numero)}</Numero>`,
    `<ImportoTotaleDocumento>${totale}</ImportoTotaleDocumento>`,
    input.causale ? `<Causale>${esc(input.causale)}</Causale>` : '',
    '</DatiGeneraliDocumento>',
    '</DatiGenerali>',
    '<DatiBeniServizi>',
    '<DettaglioLinee>',
    '<NumeroLinea>1</NumeroLinea>',
    `<Descrizione>${esc(input.descrizione)}</Descrizione>`,
    `<PrezzoUnitario>${imponibile}</PrezzoUnitario>`,
    `<PrezzoTotale>${imponibile}</PrezzoTotale>`,
    `<AliquotaIVA>${aliquota}</AliquotaIVA>`,
    natura ? `<Natura>${esc(natura)}</Natura>` : '',
    '</DettaglioLinee>',
    '<DatiRiepilogo>',
    `<AliquotaIVA>${aliquota}</AliquotaIVA>`,
    natura ? `<Natura>${esc(natura)}</Natura>` : '',
    `<ImponibileImporto>${imponibile}</ImponibileImporto>`,
    `<Imposta>${imposta}</Imposta>`,
    natura ? `<RiferimentoNormativo>${esc(FORFETTARIO_RIF_NORMATIVO)}</RiferimentoNormativo>` : '',
    '</DatiRiepilogo>',
    '</DatiBeniServizi>',
    '</FatturaElettronicaBody>',
  ]
    .filter(Boolean)
    .join('');
}

/** Costruisce la stringa XML FatturaPA (FPR12) per un documento fiscale PV. */
export function buildFatturaPaXml(input: FatturaPaInput): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<p:FatturaElettronica versione="FPR12"' +
    ' xmlns:ds="http://www.w3.org/2000/09/xmldsig#"' +
    ' xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2"' +
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    header(input) +
    body(input) +
    '</p:FatturaElettronica>'
  );
}
