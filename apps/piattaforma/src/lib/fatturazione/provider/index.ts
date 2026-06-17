import 'server-only';
import { MockFatturazioneProvider } from './mock';
import type { FatturazioneProvider } from './types';

export * from './types';
export { MockFatturazioneProvider } from './mock';

/**
 * Restituisce il provider di fatturazione attivo. Selezione via env
 * `FATTURAZIONE_PROVIDER` (default 'mock'). Il provider reale 'acube' verrà
 * agganciato quando l'account esterno sarà attivo: per ora solleva un errore
 * esplicito così che nessuno trasmetta inavvertitamente con una config incompleta.
 */
export function getFatturazioneProvider(
  nome: string | undefined = process.env.FATTURAZIONE_PROVIDER,
): FatturazioneProvider {
  switch ((nome ?? 'mock').toLowerCase()) {
    case 'mock':
      return new MockFatturazioneProvider();
    case 'acube':
      throw new Error(
        'Provider "acube" non ancora configurato: manca l\'account/credenziali A-Cube. ' +
          'Imposta FATTURAZIONE_PROVIDER=mock oppure completa l\'integrazione A-Cube.',
      );
    default:
      throw new Error(`Provider di fatturazione sconosciuto: "${nome}".`);
  }
}
