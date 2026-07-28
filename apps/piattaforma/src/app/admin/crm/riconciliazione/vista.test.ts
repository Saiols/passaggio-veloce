import { describe, it, expect } from 'vitest';
import { propostaPerVista } from './vista';
import type { Proposta } from '@/lib/crm/match/engine';

/**
 * Review giro 1/5 (Finding 1, Important): le props di un Client Component
 * finiscono per intero nel payload RSC spedito al browser, a prescindere da
 * cosa il componente renderizza davvero. `sorgente` porta l'anagrafica
 * grezza di company e sede (email, telefono, indirizzo, P.IVA) e non deve
 * mai attraversarlo: questo test fissa il comportamento di
 * `propostaPerVista`, il punto che la pagina admin usa PRIMA di passare le
 * proposte a `RiconciliazioneClient`.
 */
const PROPOSTA: Proposta = {
  contactId: 'x1',
  contactNome: 'Agenzia Corsico Pratiche Auto',
  contactTel: '+39 02 447 8712',
  contactCitta: 'Corsico',
  companyId: 'c1',
  companyNome: 'AGENZIA CORSICO',
  sedeId: null,
  sedeNome: null,
  cat: 'AGENZIA',
  punteggio: 80,
  campi: ['tel', 'indirizzo'],
  registrataAt: new Date('2026-03-15T00:00:00Z'),
  sorgente: {
    company: {
      email: 'info@agenziacorsico.it',
      telefono: '02 4478712',
      partitaIva: '01234567890',
      indirizzo: 'Via Fiume',
      civico: '6',
      citta: 'Corsico',
      cap: '20094',
      provincia: 'MI',
    },
    sede: null,
  },
  ambigua: false,
};

describe('propostaPerVista', () => {
  it('toglie sorgente: non deve mai arrivare al browser', () => {
    const vista = propostaPerVista(PROPOSTA);
    expect('sorgente' in vista).toBe(false);
    expect(Object.keys(vista)).not.toContain('sorgente');
  });

  it('lascia intatti tutti gli altri campi (quelli che la tabella mostra davvero)', () => {
    const vista = propostaPerVista(PROPOSTA);
    expect(vista).toEqual({
      contactId: 'x1',
      contactNome: 'Agenzia Corsico Pratiche Auto',
      contactTel: '+39 02 447 8712',
      contactCitta: 'Corsico',
      companyId: 'c1',
      companyNome: 'AGENZIA CORSICO',
      sedeId: null,
      sedeNome: null,
      cat: 'AGENZIA',
      punteggio: 80,
      campi: ['tel', 'indirizzo'],
      registrataAt: new Date('2026-03-15T00:00:00Z'),
      ambigua: false,
    });
  });
});
