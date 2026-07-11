import type { RegimeFiscale, DocumentoFiscaleTipo, FatturaPaTipo } from '@pv/db';

export type SplitImporto = {
  imponibileCent: number;
  ivaCent: number;
  aliquotaIvaPct: number;
};

/**
 * Scorpora un importo LORDO in imponibile + IVA secondo il regime.
 * ORDINARIO: IVA 22% scorporata. FORFETTARIO/PRIVATO: fuori campo (iva 0).
 * Preserva il segno (per le note di credito negative).
 */
export function splitImporto(lordoCent: number, regime: RegimeFiscale): SplitImporto {
  if (regime === 'ORDINARIO') {
    const imponibile = Math.round(lordoCent / 1.22);
    return {
      imponibileCent: imponibile,
      ivaCent: lordoCent - imponibile,
      aliquotaIvaPct: 22,
    };
  }
  return { imponibileCent: lordoCent, ivaCent: 0, aliquotaIvaPct: 0 };
}

/**
 * Tipo FatturaPA in base al tipo documento e al regime dell'emittente.
 * FATTURA_PV → TD01. NOTA_VARIAZIONE → TD04. DOC_BROKER → TD01 (ordinario) /
 * TD06 (forfettario) / null (privato, ricevuta non fiscale, no XML).
 */
export function fatturaPaTipoPerRegime(
  tipo: DocumentoFiscaleTipo,
  regime: RegimeFiscale,
): FatturaPaTipo | null {
  if (tipo === 'NOTA_VARIAZIONE') return 'TD04';
  if (tipo === 'FATTURA_PV') return 'TD01';
  if (tipo === 'DOC_BROKER') {
    if (regime === 'ORDINARIO') return 'TD01';
    if (regime === 'FORFETTARIO') return 'TD06';
    return null; // PRIVATO
  }
  // PENALE_BROKER: clausola 10.4(b) dei Termini — la penale non è soggetta a
  // IVA (fuori campo ex art. 15, co. 1, n. 1, D.P.R. 633/1972). Non è un
  // corrispettivo per un servizio reso, quindi non genera alcun documento
  // fiscale/FatturaPA: il valore è deliberatamente `null` per ogni regime.
  return null; // PENALE_BROKER → fuori campo IVA, nessun documento fiscale
}
