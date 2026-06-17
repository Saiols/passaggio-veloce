import {
  STATI_SDI,
  type EmissioneParams,
  type EmissioneResult,
  type FatturazioneProvider,
  type StatoSdi,
  type StatoSdiResult,
  type WebhookEvento,
} from './types';

function isStatoSdi(v: unknown): v is StatoSdi {
  return typeof v === 'string' && (STATI_SDI as readonly string[]).includes(v);
}

/**
 * Provider fittizio per sviluppo/test: simula l'happy path della trasmissione SDI
 * in modo deterministico (nessuna chiamata di rete). Resta attivo finché non viene
 * configurato il provider reale (A-Cube) tramite env `FATTURAZIONE_PROVIDER`.
 */
export class MockFatturazioneProvider implements FatturazioneProvider {
  readonly nome = 'mock';

  async emetti(params: EmissioneParams): Promise<EmissioneResult> {
    const idSdi = `MOCK-${params.riferimento}`;
    return {
      idSdi,
      stato: 'INVIATO',
      xmlKey: `mock://xml/${params.riferimento}`,
    };
  }

  async statoSdi(idSdi: string): Promise<StatoSdiResult> {
    return {
      idSdi,
      stato: 'CONSEGNATO',
      dataAggiornamento: new Date(),
      messaggio: 'Mock: documento recapitato',
    };
  }

  parseWebhook(payload: unknown): WebhookEvento | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const p = payload as Record<string, unknown>;
    if (typeof p.idSdi !== 'string' || !isStatoSdi(p.stato)) return null;
    const data =
      typeof p.dataAggiornamento === 'string' ? new Date(p.dataAggiornamento) : new Date();
    return {
      idSdi: p.idSdi,
      stato: p.stato,
      dataAggiornamento: Number.isNaN(data.getTime()) ? new Date() : data,
      messaggio: typeof p.messaggio === 'string' ? p.messaggio : null,
    };
  }
}
