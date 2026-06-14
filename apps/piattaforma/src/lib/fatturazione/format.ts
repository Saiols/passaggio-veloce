import type { DocumentoFiscaleTipo } from '@pv/db';

/** Numero documento leggibile: "<progressivo>/<anno>". */
export function numeroDocumento(d: { numeroProgressivo: number; anno: number }): string {
  return `${d.numeroProgressivo}/${d.anno}`;
}

const LABELS: Record<DocumentoFiscaleTipo, string> = {
  FATTURA_PV: 'Fattura',
  DOC_BROKER: 'Compenso intermediazione',
  NOTA_VARIAZIONE: 'Nota di credito',
  PENALE_BROKER: 'Penale',
};

/** Etichetta utente per il tipo di documento fiscale. */
export function labelTipoDocumento(tipo: DocumentoFiscaleTipo): string {
  return LABELS[tipo];
}
