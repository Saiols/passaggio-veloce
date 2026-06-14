import { BRAND } from '@/lib/seo/brand';

/** Dati fiscali "congelati" su un documento (snapshot immutabile). */
export type DatiFiscali = {
  ragioneSociale: string;
  partitaIva: string;
  codiceSdi: string | null;
  pec: string | null;
  indirizzo: string;
  cap: string;
  citta: string;
  provincia: string;
};

/**
 * Dati fiscali di Passaggio Veloce S.r.l. (emittente delle FATTURA_PV, e
 * destinatario dei DOC_BROKER conto terzi). Default dal BRAND (P.IVA reale);
 * sovrascrivibili via env per la prod (PV_RAGIONE_SOCIALE, PV_CODICE_SDI, PV_PEC,
 * PV_INDIRIZZO, PV_CAP, PV_CITTA, PV_PROVINCIA).
 */
export function pvEmittente(): DatiFiscali {
  return {
    ragioneSociale: process.env.PV_RAGIONE_SOCIALE ?? BRAND.legalName,
    partitaIva: process.env.PV_PARTITA_IVA ?? BRAND.vatId,
    codiceSdi: process.env.PV_CODICE_SDI ?? null,
    pec: process.env.PV_PEC ?? null,
    indirizzo: process.env.PV_INDIRIZZO ?? '',
    cap: process.env.PV_CAP ?? '',
    citta: process.env.PV_CITTA ?? '',
    provincia: process.env.PV_PROVINCIA ?? '',
  };
}

/** Snapshot dei dati fiscali di una Company (broker/agenzia). */
export function snapshotCompany(c: {
  ragioneSociale: string;
  partitaIva: string;
  codiceSdi: string | null;
  pec: string;
  indirizzo: string;
  cap: string;
  citta: string;
  provincia: string;
}): DatiFiscali {
  return {
    ragioneSociale: c.ragioneSociale,
    partitaIva: c.partitaIva,
    codiceSdi: c.codiceSdi,
    pec: c.pec,
    indirizzo: c.indirizzo,
    cap: c.cap,
    citta: c.citta,
    provincia: c.provincia,
  };
}
