import type {
  CompanyRegistryData,
  RegistroImpreseLookupInput,
  RegistroImpreseProvider,
} from './types';

/** Provider che non interroga nessun registro: ritorna null. Usato in
 * produzione finché non è attivo un account reale (niente dati finti). */
export class NoopRegistroImpreseProvider implements RegistroImpreseProvider {
  readonly name = 'noop' as const;
  async lookupByPiva(_input: RegistroImpreseLookupInput): Promise<CompanyRegistryData | null> {
    return null;
  }
}
