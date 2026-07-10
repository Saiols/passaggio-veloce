import { describe, expect, it } from 'vitest';
import { descrizioneDocumento } from './descrizione';

const vuoto = { payout: null, notaVariazionePer: null } as const;

describe('descrizioneDocumento — FATTURA_PV multiplo', () => {
  it('pratica singola: descrizione invariata', () => {
    const r = descrizioneDocumento({
      ...vuoto,
      tipo: 'FATTURA_PV',
      pratica: { codicePratica: 'PV-1', numeroVeicoli: 1 },
    });
    expect(r.descrizione).toBe('Servizio di intermediazione per passaggio di proprietà');
    expect(r.riferimento).toBe('Pratica PV-1');
  });

  it('pratica multipla: aggiunge "multiplo (N veicoli)"', () => {
    const r = descrizioneDocumento({
      ...vuoto,
      tipo: 'FATTURA_PV',
      pratica: { codicePratica: 'PV-2', numeroVeicoli: 3 },
    });
    expect(r.descrizione).toBe(
      'Servizio di intermediazione per passaggio di proprietà multiplo (3 veicoli)',
    );
  });

  it('numeroVeicoli assente → singolare', () => {
    const r = descrizioneDocumento({
      ...vuoto,
      tipo: 'FATTURA_PV',
      pratica: { codicePratica: 'PV-3' },
    });
    expect(r.descrizione).toBe('Servizio di intermediazione per passaggio di proprietà');
  });

  it('altri tipi (PENALE_BROKER) invariati anche con più veicoli', () => {
    const r = descrizioneDocumento({
      ...vuoto,
      tipo: 'PENALE_BROKER',
      pratica: { codicePratica: 'PV-4', numeroVeicoli: 5 },
    });
    expect(r.descrizione).toBe('Penale');
  });
});
