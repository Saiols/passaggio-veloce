import type { PraticaStato } from '@/components/ui';

/**
 * Trattamento "extra" dello stato pratica lato broker/agenzia (Sistema Penali
 * Broker). Modulo PURO: dai campi già presenti sulla Pratica deriva se mostrare
 * la pill "Segnalata / in revisione" o il motivo dell'annullamento — senza
 * toccare lo `stato` grezzo del DB. Spec:
 * docs/superpowers/specs/2026-07-03-stato-segnalazione-annullamento-broker-design.md
 */

export type SegnalazioneTipo =
  | 'FERMO_AMMINISTRATIVO'
  | 'IPOTECA'
  | 'DOCUMENTO_NON_VALIDO'
  | 'ALTRO';

export type SegnalazioneStato = 'RICEVUTA' | 'CONFERMATA' | 'RESPINTA';

/** Sottoinsieme dei campi Pratica necessari al calcolo (già in query lista+dettaglio). */
export type StatoExtraInput = {
  stato: PraticaStato;
  flagSegnalata: boolean;
  segnalazioneStato: SegnalazioneStato | null;
  tipoSegnalazione: SegnalazioneTipo | null;
  notaSegnalazione: string | null;
  penaleAddebitatoCent: number | null;
  revisioneCompletata: boolean;
  richiedeRevisioneManuale: boolean;
};

export type StatoExtra =
  | { kind: 'IN_REVISIONE'; tipo: SegnalazioneTipo | null; nota: string | null }
  | {
      kind: 'ANNULLATA_TEAM';
      origine: 'SEGNALAZIONE';
      tipo: SegnalazioneTipo | null;
      nota: string | null;
      penaleCent: number | null;
    }
  | { kind: 'ANNULLATA_TEAM'; origine: 'REVISIONE' }
  | null;

/**
 * Deriva il trattamento extra dallo stato della pratica. Ordine di precedenza:
 * 1. Segnalazione RICEVUTA (pre-esito) → in revisione, a prescindere dallo stato.
 * 2. ANNULLATA da segnalazione confermata → motivo = tipo segnalazione.
 * 3. ANNULLATA da revisione documentale del team → motivo generico revisione.
 * 4. Tutto il resto (incl. auto-annullo del broker, RESPINTA) → nessun trattamento.
 */
export function statoExtra(p: StatoExtraInput): StatoExtra {
  if (p.flagSegnalata && p.segnalazioneStato === 'RICEVUTA') {
    return { kind: 'IN_REVISIONE', tipo: p.tipoSegnalazione, nota: p.notaSegnalazione };
  }

  if (p.stato === 'ANNULLATA') {
    if (p.segnalazioneStato === 'CONFERMATA') {
      return {
        kind: 'ANNULLATA_TEAM',
        origine: 'SEGNALAZIONE',
        tipo: p.tipoSegnalazione,
        nota: p.notaSegnalazione,
        penaleCent: p.penaleAddebitatoCent,
      };
    }
    // Chiusura revisione come ANNULLATA lascia richiedeRevisioneManuale=true e
    // imposta revisioneCompletata=true; come RISOLTA azzera invece la richiesta.
    // Così distinguiamo l'annullo-da-revisione dal risolta-poi-auto-annullo.
    if (p.revisioneCompletata && p.richiedeRevisioneManuale) {
      return { kind: 'ANNULLATA_TEAM', origine: 'REVISIONE' };
    }
  }

  return null;
}

/** Etichetta italiana leggibile del tipo di segnalazione. */
export function tipoSegnalazioneLabel(t: SegnalazioneTipo): string {
  switch (t) {
    case 'FERMO_AMMINISTRATIVO':
      return 'Fermo amministrativo';
    case 'IPOTECA':
      return 'Ipoteca';
    case 'DOCUMENTO_NON_VALIDO':
      return 'Documento non valido';
    case 'ALTRO':
      return 'Altro';
  }
}
