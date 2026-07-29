import { describe, it, expect } from 'vitest';
import {
  nextStatoInvio,
  nextStatoApertura,
  defaultMessaggioPartenza,
} from './email-partenza';

describe('nextStatoInvio — avanza-non-declassa', () => {
  it('porta S0..S3 a S4', () => {
    for (const s of ['S0', 'S1', 'S2', 'S3']) {
      expect(nextStatoInvio(s)).toBe('S4');
    }
  });
  it('non declassa stati già avanzati', () => {
    for (const s of ['S5', 'S6', 'S7', 'S8', 'S9']) {
      expect(nextStatoInvio(s)).toBe(s);
    }
  });
  it('non tocca S10 (churned)', () => {
    expect(nextStatoInvio('S10')).toBe('S10');
  });
});

describe('nextStatoApertura — avanza-non-declassa', () => {
  it('porta S0..S4 a S5', () => {
    for (const s of ['S0', 'S1', 'S2', 'S3', 'S4']) {
      expect(nextStatoApertura(s)).toBe('S5');
    }
  });
  it('non declassa S6/S7+', () => {
    for (const s of ['S6', 'S7', 'S8']) {
      expect(nextStatoApertura(s)).toBe(s);
    }
  });

  it('mandare il link a un contatto da richiamare non chiude il richiamo', () => {
    // Il cliente ha chiesto di essere risentito: ricevere il link non toglie
    // quella promessa, quindi lo stato (e con lui il promemoria) resta.
    expect(nextStatoInvio('S11')).toBe('S11');
    expect(nextStatoApertura('S11')).toBe('S11');
  });
});

describe('defaultMessaggioPartenza — testo predefinito editabile', () => {
  it('interpola la ragione sociale nel primo paragrafo', () => {
    const msg = defaultMessaggioPartenza({
      categoria: 'BROKER',
      ragioneSociale: 'Autosalone Rossi Srl',
    });
    expect(msg).toContain('attivare Autosalone Rossi Srl su Passaggio Veloce');
    expect(msg).toContain('Bastano circa 5 minuti');
  });

  it('BROKER: usa il contesto broker', () => {
    const msg = defaultMessaggioPartenza({ categoria: 'BROKER', ragioneSociale: 'X' });
    expect(msg).toContain('la prende in carico e la segui in tempo reale');
    expect(msg).not.toContain('già complete e verificate dalla tua provincia');
  });

  it('AGENZIA: usa il contesto agenzia', () => {
    const msg = defaultMessaggioPartenza({ categoria: 'AGENZIA', ragioneSociale: 'X' });
    expect(msg).toContain('già complete e verificate dalla tua provincia');
    expect(msg).not.toContain('la prende in carico e la segui in tempo reale');
  });

  it('separa i paragrafi con una riga vuota (\\n\\n)', () => {
    const msg = defaultMessaggioPartenza({ categoria: 'BROKER', ragioneSociale: 'X' });
    expect(msg).toContain('\n\n');
  });
});
