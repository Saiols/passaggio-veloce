import type { DocumentoFiscaleTipo } from '@pv/db';
import { formatDate } from '@/lib/format';
import { labelTipoDocumento } from './format';

/** Forma minima del documento necessaria a comporre descrizione e riferimento. */
export type DescrizioneDoc = {
  tipo: DocumentoFiscaleTipo;
  pratica: { codicePratica: string | null } | null;
  payout: {
    eseguitoAt: Date | null;
    transazioni: { pratica: { codicePratica: string | null } | null }[];
  } | null;
  notaVariazionePer: { numeroDocumentoStr: string | null } | null;
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
          ? `Storno documento N° ${doc.notaVariazionePer.numeroDocumentoStr ?? ''}`
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

/** Snapshot minimo di una Sede per il riferimento in fattura. */
type SedeSnap = { nome: string; citta: string; provincia: string };

/**
 * Sede operativa a cui il documento si riferisce. I dati fiscali del documento
 * restano quelli della company madre (soggetto fiscale), ma in fattura è utile
 * sapere *di quale sede* si tratta. `lato` indica a quale parte (emittente o
 * destinatario) appartiene la sede, così da renderla accanto a quella giusta.
 */
export type SedeRiferimento = SedeSnap & { lato: 'emittente' | 'destinatario' };

/**
 * Forma minima del documento necessaria a risolvere la sede di riferimento.
 * `pratica`/`payout` sono opzionali così che le liste che caricano solo una
 * delle due relation (es. lista agenzia → pratica, lista broker → payout)
 * possano passare il documento senza includere l'altra.
 */
export type SedeRiferimentoDoc = {
  tipo: DocumentoFiscaleTipo;
  pratica?: { agenziaSede: SedeSnap | null; brokerSede: SedeSnap | null } | null;
  payout?: { wallet: { sede: SedeSnap | null } | null } | null;
};

function snap(s: SedeSnap | null | undefined): SedeSnap | null {
  return s ? { nome: s.nome, citta: s.citta, provincia: s.provincia } : null;
}

/**
 * Deriva la sede di riferimento dalle relation esistenti (nessuno snapshot
 * dedicato → copre anche i documenti storici e le note, che ereditano
 * pratica/payout dall'originale):
 *  - DOC_BROKER e note su payout → sede del broker = sede del wallet del payout
 *    (parte EMITTENTE);
 *  - FATTURA_PV / NOTA su pratica → sede dell'agenzia che ha lavorato la pratica
 *    (parte DESTINATARIO);
 *  - PENALE_BROKER → sede del broker della pratica (parte DESTINATARIO).
 * Ritorna `null` quando nessuna sede è collegata (caso 1:1 senza sede, wallet
 * affiliazione madre, documenti emessi prima del multi-sede).
 */
export function resolveSedeRiferimento(doc: SedeRiferimentoDoc): SedeRiferimento | null {
  const sedePayout = snap(doc.payout?.wallet?.sede);
  if (sedePayout) return { ...sedePayout, lato: 'emittente' };
  const sedePratica = snap(
    doc.tipo === 'PENALE_BROKER' ? doc.pratica?.brokerSede : doc.pratica?.agenziaSede,
  );
  if (sedePratica) return { ...sedePratica, lato: 'destinatario' };
  return null;
}
