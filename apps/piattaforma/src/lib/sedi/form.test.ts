import { describe, it, expect } from 'vitest';
import { parseSedeFields } from './form';

const base = {
  nome: 'AutoScout Milano',
  indirizzo: 'Via Centrale',
  civico: '1',
  citta: 'Milano',
  cap: '20100',
  provincia: 'mi',
  telefono: '0212345',
  email: 'milano@autoscout.it',
  codiceInterno: 'MI-01',
  iban: 'IT60X0542811101000000123456',
  payoutThresholdEuro: '1500,50',
};

describe('parseSedeFields', () => {
  it('input valido: normalizza (provincia maiuscola, euro→cent) e ritorna i campi', () => {
    const r = parseSedeFields(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({
      nome: 'AutoScout Milano',
      indirizzo: 'Via Centrale',
      civico: '1',
      citta: 'Milano',
      cap: '20100',
      provincia: 'MI',
      telefono: '0212345',
      email: 'milano@autoscout.it',
      codiceInterno: 'MI-01',
      iban: 'IT60X0542811101000000123456',
      payoutThresholdCent: 150050,
    });
  });

  it('campi opzionali vuoti → null', () => {
    const r = parseSedeFields({ ...base, civico: '', telefono: '', email: '', codiceInterno: '', iban: '' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.civico).toBeNull();
    expect(r.data.telefono).toBeNull();
    expect(r.data.email).toBeNull();
    expect(r.data.codiceInterno).toBeNull();
    expect(r.data.iban).toBeNull();
  });

  it('manca un campo obbligatorio → errore', () => {
    expect(parseSedeFields({ ...base, nome: '  ' }).ok).toBe(false);
    expect(parseSedeFields({ ...base, citta: '' }).ok).toBe(false);
  });

  it('provincia non di 2 lettere → errore', () => {
    const r = parseSedeFields({ ...base, provincia: 'MILA' });
    expect(r.ok).toBe(false);
  });

  it('IBAN non valido → errore; assente → ok con null', () => {
    expect(parseSedeFields({ ...base, iban: 'XX123' }).ok).toBe(false);
    const r = parseSedeFields({ ...base, iban: '' });
    expect(r.ok).toBe(true);
  });

  it('soglia payout: 0 → 0 cent, assente → default 100000, negativa/NaN → errore', () => {
    const zero = parseSedeFields({ ...base, payoutThresholdEuro: '0' });
    expect(zero.ok && zero.data.payoutThresholdCent).toBe(0);
    const assente = parseSedeFields({ ...base, payoutThresholdEuro: '' });
    expect(assente.ok && assente.data.payoutThresholdCent).toBe(100000);
    expect(parseSedeFields({ ...base, payoutThresholdEuro: '-5' }).ok).toBe(false);
    expect(parseSedeFields({ ...base, payoutThresholdEuro: 'abc' }).ok).toBe(false);
  });
});
