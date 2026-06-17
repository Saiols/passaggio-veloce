import type { DatiFiscali } from './pv-emittente';
import type { FatturaPaInput, FatturaPaParte } from './xml-fatturapa';

/**
 * Dati di un DocumentoFiscale risolti dal DB, pronti per la mappatura sull'input
 * del generatore XML. Gli snapshot `emittente`/`destinatario` sono i dati fiscali
 * congelati sul documento; `pv` sono i dati correnti di Passaggio Veloce (usati
 * come terzo emittente quando il documento è emesso per conto del cedente).
 */
export type DocumentoXmlInput = {
  fatturaPaTipo: 'TD01' | 'TD06' | 'TD04';
  /** Numero leggibile "<progressivo>/<anno>" (finisce in <Numero>). */
  numero: string;
  /** Progressivo numerico (genera il ProgressivoInvio zero-padded). */
  numeroProgressivo: number;
  data: Date;
  emittente: DatiFiscali;
  destinatario: DatiFiscali;
  /** true se l'emittente è PV stessa (FATTURA_PV): nessun terzo, regime RF01. */
  emittenteIsPv: boolean;
  imponibileCent: number | null;
  ivaCent: number | null;
  aliquotaIvaPct: number | null;
  descrizione: string;
  causale?: string | null;
  pv: DatiFiscali;
};

/** Snapshot DatiFiscali → parte FatturaPA. */
function parte(
  d: DatiFiscali,
  opts: { regimeFiscale?: string; comeCessionario?: boolean } = {},
): FatturaPaParte {
  return {
    denominazione: d.ragioneSociale,
    partitaIva: d.partitaIva || null,
    indirizzo: d.indirizzo,
    cap: d.cap,
    comune: d.citta,
    provincia: d.provincia,
    nazione: 'IT',
    ...(opts.regimeFiscale ? { regimeFiscale: opts.regimeFiscale } : {}),
    ...(opts.comeCessionario ? { codiceDestinatario: d.codiceSdi, pec: d.pec } : {}),
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Mappa un DocumentoFiscale sull'input del generatore FatturaPA.
 *
 * Regime ceduto e Natura derivano dall'aliquota:
 * - aliquota 0 + emittente broker → RF19 forfettario + Natura N2.2 (fuori campo);
 * - altrimenti → RF01 ordinario, nessuna Natura.
 * Il terzo emittente (SoggettoEmittente TZ = PV) è presente per ogni documento
 * NON emesso direttamente da PV (i compensi broker, emessi da PV per conto loro).
 */
export function toFatturaPaInput(input: DocumentoXmlInput): FatturaPaInput {
  const aliquota = input.aliquotaIvaPct ?? 0;
  const imponibile = input.imponibileCent ?? 0;
  const iva = input.ivaCent ?? 0;
  const fuoriCampo = aliquota === 0;
  const regimeCedente = fuoriCampo && !input.emittenteIsPv ? 'RF19' : 'RF01';

  return {
    tipoDocumento: input.fatturaPaTipo,
    numero: input.numero,
    data: isoDate(input.data),
    cedentePrestatore: parte(input.emittente, { regimeFiscale: regimeCedente }),
    cessionarioCommittente: parte(input.destinatario, { comeCessionario: true }),
    imponibileCent: imponibile,
    ivaCent: iva,
    aliquotaIvaPct: aliquota,
    natura: fuoriCampo ? 'N2.2' : null,
    descrizione: input.descrizione,
    causale: input.causale ?? null,
    soggettoEmittenteTerzo: input.emittenteIsPv ? null : parte(input.pv),
    progressivoInvio: String(input.numeroProgressivo).padStart(5, '0'),
    idTrasmittente: { idPaese: 'IT', idCodice: input.pv.partitaIva },
  };
}
