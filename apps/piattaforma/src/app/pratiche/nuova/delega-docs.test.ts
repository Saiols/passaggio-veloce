import { describe, it, expect } from 'vitest';
import {
  delegatoDocKey,
  procuraDelegaDocKey,
  delegaDocsComplete,
} from './delega-docs';

describe('delega-docs — slot keys', () => {
  it('genera chiavi slot per veicolo', () => {
    expect(delegatoDocKey(1)).toBe('DELEGA_DELEGATO_1');
    expect(procuraDelegaDocKey(2)).toBe('DELEGA_PROCURA_2');
  });
});

describe('delegaDocsComplete', () => {
  const ready = (keys: string[]) => (k: string) => keys.includes(k);

  it('nessun veicolo con delega → completo', () => {
    const veicoli = [{ flagDelegaVendita: false }, { flagDelegaVendita: false }];
    expect(delegaDocsComplete(veicoli, ready([]))).toBe(true);
  });

  it('delega Sì con entrambi i file → completo', () => {
    const veicoli = [{ flagDelegaVendita: true }];
    expect(
      delegaDocsComplete(veicoli, ready(['DELEGA_DELEGATO_1', 'DELEGA_PROCURA_1'])),
    ).toBe(true);
  });

  it('delega Sì con un file mancante → incompleto', () => {
    const veicoli = [{ flagDelegaVendita: true }];
    expect(delegaDocsComplete(veicoli, ready(['DELEGA_DELEGATO_1']))).toBe(false);
  });

  it('multi-veicolo: vincola solo i veicoli con delega', () => {
    const veicoli = [{ flagDelegaVendita: false }, { flagDelegaVendita: true }];
    expect(
      delegaDocsComplete(veicoli, ready(['DELEGA_DELEGATO_2', 'DELEGA_PROCURA_2'])),
    ).toBe(true);
    expect(delegaDocsComplete(veicoli, ready(['DELEGA_DELEGATO_2']))).toBe(false);
  });
});
