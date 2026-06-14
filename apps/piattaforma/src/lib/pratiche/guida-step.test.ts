import { describe, it, expect } from 'vitest';
import { guidaStep } from './guida-step';

describe('guidaStep', () => {
  it('agenzia in ACCETTATA: azione → processata', () => {
    const g = guidaStep({ stato: 'ACCETTATA', ruolo: 'AGENZIA', hasValutazione: false });
    expect(g.variant).toBe('azione');
    expect(g.cta).toBe('processata');
    expect(g.steps.find((s) => s.key === 'accettata')?.stato).toBe('current');
  });

  it('agenzia in PROCESSATA: azione → firma', () => {
    const g = guidaStep({ stato: 'PROCESSATA', ruolo: 'AGENZIA', hasValutazione: false });
    expect(g.variant).toBe('azione');
    expect(g.cta).toBe('firma');
    expect(g.steps.find((s) => s.key === 'processata')?.stato).toBe('current');
  });

  it('broker in ACCETTATA: attesa (nessuna cta)', () => {
    const g = guidaStep({ stato: 'ACCETTATA', ruolo: 'DEALER', hasValutazione: false });
    expect(g.variant).toBe('attesa');
    expect(g.cta).toBeNull();
  });

  it('broker in FIRMATA senza valutazione: azione → valuta', () => {
    const g = guidaStep({ stato: 'FIRMATA', ruolo: 'DEALER', hasValutazione: false });
    expect(g.variant).toBe('azione');
    expect(g.cta).toBe('valuta');
    expect(g.steps.every((s) => s.stato === 'done')).toBe(true);
  });

  it('broker in FIRMATA con valutazione: chiusa', () => {
    const g = guidaStep({ stato: 'FIRMATA', ruolo: 'DEALER', hasValutazione: true });
    expect(g.variant).toBe('chiusa');
    expect(g.cta).toBeNull();
  });

  it('broker in attesa accettazione: attesa, step accettata = current con label attesa', () => {
    const g = guidaStep({ stato: 'IN_ATTESA_ROUND_1', ruolo: 'DEALER', hasValutazione: false });
    expect(g.variant).toBe('attesa');
    const acc = g.steps.find((s) => s.key === 'accettata');
    expect(acc?.stato).toBe('current');
    expect(acc?.label).toBe('In attesa agenzia');
  });

  it('ANNULLATA: chiusa negativa', () => {
    const g = guidaStep({ stato: 'ANNULLATA', ruolo: 'AGENZIA', hasValutazione: false });
    expect(g.variant).toBe('chiusa');
    expect(g.chiusaNegativa).toBe(true);
  });

  it('admin (ALTRO): mai azione', () => {
    const g = guidaStep({ stato: 'PROCESSATA', ruolo: 'ALTRO', hasValutazione: false });
    expect(g.variant).not.toBe('azione');
    expect(g.cta).toBeNull();
  });
});
