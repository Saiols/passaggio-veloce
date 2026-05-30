export type RegistroImpreseProviderName = 'mock' | 'openapi' | 'infocamere';

export type StatoAttivita =
  | 'ATTIVA'
  | 'CESSATA'
  | 'IN_LIQUIDAZIONE'
  | 'SOSPESA'
  | 'SCONOSCIUTO';

export type CompanyRegistryData = {
  partitaIva: string;
  denominazione: string;
  formaGiuridica?: string;
  sedeLegale?: {
    indirizzo?: string;
    citta?: string;
    cap?: string;
    provincia?: string;
  };
  statoAttivita: StatoAttivita;
  dataIscrizione?: string; // ISO yyyy-mm-dd
  ateco?: string;
  pec?: string;
  capitaleSociale?: number;
  amministratori?: Array<{ nome: string; cognome: string; carica?: string }>;
  numeroRea?: string;
};

export type RegistroImpreseLookupInput = { partitaIva: string };

export interface RegistroImpreseProvider {
  readonly name: RegistroImpreseProviderName;
  /** Ritorna i dati ufficiali dell'azienda dato il P.IVA, o null se non trovata. */
  lookupByPiva(input: RegistroImpreseLookupInput): Promise<CompanyRegistryData | null>;
}
