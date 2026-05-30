import { createHash } from 'node:crypto';
import type {
  CompanyRegistryData,
  RegistroImpreseLookupInput,
  RegistroImpreseProvider,
} from './types';

const SAMPLE_DENOMINAZIONI = [
  'Auto Service Italia',
  'Rossi Motori',
  'Bianchi Veicoli',
  'Verdi Automobili',
  'Neri Trasporti',
];
const SAMPLE_FORME = ['SRL', 'SRLS', 'SPA', 'SNC', 'Ditta Individuale'];
const SAMPLE_CITTA = ['Milano', 'Roma', 'Torino', 'Napoli', 'Bologna'];

export class MockRegistroImpreseProvider implements RegistroImpreseProvider {
  readonly name = 'mock' as const;

  async lookupByPiva(
    input: RegistroImpreseLookupInput,
  ): Promise<CompanyRegistryData | null> {
    const hash = createHash('sha256').update(input.partitaIva).digest();
    const pick = (arr: readonly string[], offset: number): string =>
      arr[hash[offset]! % arr.length]!;

    await new Promise((resolve) => setTimeout(resolve, 50)); // simula latenza API

    return {
      partitaIva: input.partitaIva,
      denominazione: `${pick(SAMPLE_DENOMINAZIONI, 0)} ${pick(SAMPLE_FORME, 1)}`,
      formaGiuridica: pick(SAMPLE_FORME, 1),
      sedeLegale: { citta: pick(SAMPLE_CITTA, 2) },
      statoAttivita: 'ATTIVA',
      dataIscrizione: `20${10 + (hash[3]! % 14)}-01-15`,
      ateco: '45.11.01',
      numeroRea: `MI-${100000 + (hash[4]! % 800000)}`,
    };
  }
}
