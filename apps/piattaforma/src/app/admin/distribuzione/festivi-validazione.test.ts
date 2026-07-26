import { describe, it, expect } from 'vitest';
import { validaAggiuntaFestivo } from './festivi-validazione';

const ESISTENTI = [{ data: '2026-12-25', nome: 'Natale' }];

describe('validaAggiuntaFestivo', () => {
  it('accetta una data valida, nome pieno, non duplicata', () => {
    expect(validaAggiuntaFestivo(ESISTENTI, '2026-08-15', 'Ferragosto')).toBeNull();
  });

  it('respinge una data vuota', () => {
    expect(validaAggiuntaFestivo(ESISTENTI, '', 'Ferragosto')).toBe('data-invalida');
  });

  it('respinge una data di calendario impossibile', () => {
    expect(validaAggiuntaFestivo(ESISTENTI, '2026-02-30', 'Ferragosto')).toBe('data-invalida');
  });

  it('respinge un nome vuoto', () => {
    expect(validaAggiuntaFestivo(ESISTENTI, '2026-08-15', '')).toBe('nome-mancante');
  });

  it('respinge un nome fatto solo di spazi', () => {
    expect(validaAggiuntaFestivo(ESISTENTI, '2026-08-15', '   ')).toBe('nome-mancante');
  });

  it('respinge una data già presente in elenco', () => {
    expect(validaAggiuntaFestivo(ESISTENTI, '2026-12-25', 'Vigilia')).toBe('data-duplicata');
  });

  it('la data invalida precede la duplicazione: controlla prima il formato', () => {
    // Se la data è malformata non ha senso cercarla nell'elenco.
    expect(validaAggiuntaFestivo(ESISTENTI, 'non-una-data', 'X')).toBe('data-invalida');
  });
});
