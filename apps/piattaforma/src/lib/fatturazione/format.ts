import type { DocumentoFiscaleTipo } from '@pv/db';

const pad = (n: number, len: number): string => String(n).padStart(len, '0');

/**
 * Numero documento leggibile e fiscale (paper NumerazioneFatture):
 * - FATTURA_PV:        PV-<anno>-<5 cifre>            es. PV-2026-00007
 * - DOC_BROKER:        PV-<id4>-<anno>-<5 cifre>      es. PV-0047-2026-00003
 * - NOTA_VARIAZIONE:   NC-[<id4>-]<anno>-<5 cifre>    es. NC-2026-00012 / NC-0047-2026-00002
 * - PENALE_BROKER:     PN-[<id4>-]<anno>-<5 cifre>
 * `emittenteNumeroSoggetto` = Company.numeroSoggetto del broker (null per documenti PV).
 */
export function numeroDocumento(d: {
  tipo: DocumentoFiscaleTipo;
  numeroProgressivo: number;
  anno: number;
  emittenteNumeroSoggetto?: number | null;
}): string {
  const seq = pad(d.numeroProgressivo, 5);
  const id = d.emittenteNumeroSoggetto != null ? pad(d.emittenteNumeroSoggetto, 4) : null;
  switch (d.tipo) {
    case 'FATTURA_PV':
      return `PV-${d.anno}-${seq}`;
    case 'DOC_BROKER':
      if (id == null) throw new Error('DOC_BROKER richiede emittenteNumeroSoggetto');
      return `PV-${id}-${d.anno}-${seq}`;
    case 'NOTA_VARIAZIONE':
      return id ? `NC-${id}-${d.anno}-${seq}` : `NC-${d.anno}-${seq}`;
    case 'PENALE_BROKER':
      return id ? `PN-${id}-${d.anno}-${seq}` : `PN-${d.anno}-${seq}`;
    default: {
      const _exhaustive: never = d.tipo;
      throw new Error(`Tipo documento non gestito: ${String(_exhaustive)}`);
    }
  }
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

/**
 * Messaggio da mostrare quando la lista fatture (/admin/fatturazione) mostra
 * meno righe di quante ne rispettano i filtri correnti: la `findMany` ha un
 * `take` senza paginazione, mentre i conteggi dei tab sono `count()` sul
 * totale vero — senza questo messaggio il tab direbbe un numero e la tabella
 * ne mostrerebbe di meno in silenzio (lo stesso difetto già corretto su
 * /admin/pratiche). `null` quando `mostrati` copre già tutto il `totale`: la
 * tabella non sta mentendo, non c'è nulla da dire.
 */
export function messaggioTroncamento(mostrati: number, totale: number): string | null {
  if (totale <= mostrati) return null;
  return `Mostrati i primi ${mostrati} di ${totale} documenti — affina i filtri per vederli tutti.`;
}
