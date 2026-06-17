/**
 * Astrazione provider-agnostica per la trasmissione SDI delle fatture elettroniche.
 * Modellata sul ciclo di vita tipico di un provider API-first (es. A-Cube):
 * emetti → poll stato → webhook di aggiornamento. L'implementazione reale
 * (A-Cube) si aggancerà a questa interfaccia senza toccare il resto del sistema.
 */

/** Stato SDI normalizzato (indipendente dal vocabolario del singolo provider). */
export type StatoSdi =
  | 'IN_ELABORAZIONE' // accettato dal provider, non ancora inoltrato a SdI
  | 'INVIATO' // trasmesso a SdI
  | 'CONSEGNATO' // recapitato al destinatario
  | 'MANCATA_CONSEGNA' // accettato da SdI ma non recapitato (canale destinatario KO)
  | 'SCARTATO' // scartato da SdI (errore formale/XSD)
  | 'ERRORE'; // errore tecnico lato provider

export const STATI_SDI: readonly StatoSdi[] = [
  'IN_ELABORAZIONE',
  'INVIATO',
  'CONSEGNATO',
  'MANCATA_CONSEGNA',
  'SCARTATO',
  'ERRORE',
];

export type EmissioneParams = {
  /** XML FatturaPA già serializzato. */
  xml: string;
  /** Nome file convenzione SdI: IT{piva}_{progressivo}.xml. */
  nomeFile: string;
  /** Riferimento interno (DocumentoFiscale.id) per la riconciliazione. */
  riferimento: string;
};

export type EmissioneResult = {
  /** Identificativo lato provider/SdI per polling e webhook. */
  idSdi: string;
  stato: StatoSdi;
  /** Chiave/URL dell'XML conservato lato provider (conservazione a norma). */
  xmlKey?: string | null;
};

export type StatoSdiResult = {
  idSdi: string;
  stato: StatoSdi;
  dataAggiornamento: Date;
  messaggio?: string | null;
};

/** Evento di aggiornamento ricevuto via webhook (normalizzato). */
export type WebhookEvento = StatoSdiResult;

export interface FatturazioneProvider {
  /** Nome del provider attivo (per log/diagnostica). */
  readonly nome: string;
  /** Trasmette l'XML al SdI e ritorna l'identificativo per il tracciamento. */
  emetti(params: EmissioneParams): Promise<EmissioneResult>;
  /** Recupera lo stato corrente di un documento trasmesso. */
  statoSdi(idSdi: string): Promise<StatoSdiResult>;
  /** Normalizza un payload webhook del provider in un evento; null se non valido. */
  parseWebhook(payload: unknown): WebhookEvento | null;
}
