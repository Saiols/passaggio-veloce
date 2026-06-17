import type { DocumentoFiscaleTipo } from '@pv/db';
import { formatDate } from '@/lib/format';
import { numeroDocumento, labelTipoDocumento } from './format';

/** Forma minima del documento necessaria a comporre descrizione e riferimento. */
export type DescrizioneDoc = {
  tipo: DocumentoFiscaleTipo;
  pratica: { codicePratica: string | null } | null;
  payout: {
    eseguitoAt: Date | null;
    transazioni: { pratica: { codicePratica: string | null } | null }[];
  } | null;
  notaVariazionePer: { numeroProgressivo: number; anno: number } | null;
};

/**
 * Descrizione (riga documento) + riferimento (causale) per tipo, condivisa da
 * PDF copia di cortesia e XML FatturaPA così che restino allineati.
 */
export function descrizioneDocumento(doc: DescrizioneDoc): {
  descrizione: string;
  riferimento: string | null;
} {
  switch (doc.tipo) {
    case 'FATTURA_PV':
      return {
        descrizione: 'Servizio di intermediazione per passaggio di proprietà',
        riferimento: doc.pratica?.codicePratica ? `Pratica ${doc.pratica.codicePratica}` : null,
      };
    case 'DOC_BROKER': {
      const codici = (doc.payout?.transazioni ?? [])
        .map((t) => t.pratica?.codicePratica)
        .filter((c): c is string => Boolean(c));
      const dataPayout = doc.payout?.eseguitoAt ? formatDate(doc.payout.eseguitoAt) : '—';
      return {
        descrizione: 'Compenso di intermediazione',
        riferimento: `Payout del ${dataPayout}${codici.length ? ` · pratiche: ${codici.join(', ')}` : ''}`,
      };
    }
    case 'NOTA_VARIAZIONE':
      return {
        descrizione: doc.notaVariazionePer
          ? `Storno documento N° ${numeroDocumento(doc.notaVariazionePer)}`
          : 'Nota di variazione in diminuzione',
        riferimento: doc.pratica?.codicePratica ? `Pratica ${doc.pratica.codicePratica}` : null,
      };
    case 'PENALE_BROKER':
      return {
        descrizione: 'Penale',
        riferimento: doc.pratica?.codicePratica ? `Pratica ${doc.pratica.codicePratica}` : null,
      };
    default:
      return { descrizione: labelTipoDocumento(doc.tipo), riferimento: null };
  }
}
