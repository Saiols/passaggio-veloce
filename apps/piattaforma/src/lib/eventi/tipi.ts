/**
 * Eventi pratica in-app (modale istantanea alla controparte). `tipo` è una
 * costante stringa (non enum DB) per non vincolare lo schema: i valori vivono
 * qui e sono usati solo lato app.
 */
export const EVENTO = {
  NUOVA_PRATICA: 'NUOVA_PRATICA',
  PRATICA_ACCETTATA: 'PRATICA_ACCETTATA',
  PRATICA_LAVORATA: 'PRATICA_LAVORATA',
  PRATICA_FIRMATA: 'PRATICA_FIRMATA',
  PRATICA_ESCALATION: 'PRATICA_ESCALATION',
  PRATICA_ASSEGNATA: 'PRATICA_ASSEGNATA',
  PRATICA_ANNULLATA: 'PRATICA_ANNULLATA',
  PRATICA_PENALE: 'PRATICA_PENALE',
} as const;

export type EventoTipo = (typeof EVENTO)[keyof typeof EVENTO];

/** Dati per creare un EventoPratica (riga DB + contenuto della modale). */
export type EventoPraticaInput = {
  praticaId?: string | null;
  /** Azienda madre che deve vedere la modale (la controparte dell'operazione). */
  targetCompanyId: string;
  /** Multi-sede: sede operativa destinataria (se nota). Il watcher filtra per sede. */
  targetSedeId?: string | null;
  tipo: EventoTipo;
  titolo: string;
  testo: string;
  ctaLabel?: string | null;
  ctaHref?: string | null;
};
