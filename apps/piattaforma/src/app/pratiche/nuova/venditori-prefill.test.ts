import { describe, it, expect } from 'vitest';
import { reconcileVenditori, type VendCore } from './venditori-prefill';
import type { IntestatarioPrefill } from './venditori-per-veicolo';

// Venditore di test: VendCore + marcatori per identità/documenti e tracciamento.
type V = VendCore & { identita?: boolean };

function base(partial: Partial<V> = {}): V {
  return {
    id: partial.id ?? 'x',
    veicoloOrdine: 1,
    isPG: false,
    tipoSoggetto: null,
    nome: '',
    cognome: '',
    cf: '',
    ragioneSociale: '',
    piva: '',
    telefono: '',
    email: '',
    identita: false,
    ...partial,
  };
}

function owner(partial: Partial<IntestatarioPrefill>): IntestatarioPrefill {
  return {
    isPersonaGiuridica: false,
    display: '',
    veicoloOrdine: 1,
    ...partial,
  } as IntestatarioPrefill;
}

// makeEmpty deterministico (no crypto/random nei test) + hasIdentita dal marcatore.
function opts() {
  let seq = 0;
  return {
    makeEmpty: (veicoloOrdine: number): V => base({ id: `new${(seq += 1)}`, veicoloOrdine }),
    hasIdentita: (v: V): boolean => !!v.identita,
  };
}

describe('reconcileVenditori', () => {
  it('semina il venditore vuoto di default riusandone l\'id (non ne crea uno nuovo)', () => {
    const prev: V[] = [base({ id: 'blank1', veicoloOrdine: 1 })];
    const prefill = [owner({ cognome: 'ROSSI', nome: 'MARIO', cf: 'RSSMRA', display: 'ROSSI MARIO' })];
    const out = reconcileVenditori(prev, prefill, opts());
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('blank1'); // stesso id: nessun rimpiazzo
    expect(out[0].cognome).toBe('ROSSI');
    expect(out[0].cf).toBe('RSSMRA');
  });

  it('PRESERVA il venditore esistente coi documenti su re-OCR dello stesso intestatario', () => {
    const prev: V[] = [
      base({ id: 'v1', cognome: 'ROSSI', nome: 'MARIO', cf: 'RSSMRA', telefono: '333', email: 'a@b.it', identita: true }),
    ];
    const prefill = [owner({ cognome: 'ROSSI', nome: 'MARIO', cf: 'RSSMRA', display: 'ROSSI MARIO' })];
    const out = reconcileVenditori(prev, prefill, opts());
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(prev[0]); // stesso oggetto: identità/contatti intatti
    expect(out[0].identita).toBe(true);
  });

  it('match per CF anche se il display OCR differisce (nome corretto a mano)', () => {
    const prev: V[] = [base({ id: 'v1', cognome: 'ROSSI', nome: 'MARIO', cf: 'RSSMRA', identita: true })];
    const prefill = [owner({ cognome: 'ROSSY', nome: 'MARIO', cf: 'RSSMRA', display: 'ROSSY MARIO' })];
    const out = reconcileVenditori(prev, prefill, opts());
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(prev[0]);
  });

  it('PRESERVA un co-intestatario aggiunto a mano che non corrisponde ad alcun intestatario OCR', () => {
    const prev: V[] = [
      base({ id: 'v1', cognome: 'ROSSI', nome: 'MARIO', cf: 'RSSMRA', identita: true }),
      base({ id: 'v2', cognome: 'VERDI', nome: 'LUIGI', telefono: '333', identita: true }), // manuale
    ];
    const prefill = [owner({ cognome: 'ROSSI', nome: 'MARIO', cf: 'RSSMRA', display: 'ROSSI MARIO' })];
    const out = reconcileVenditori(prev, prefill, opts());
    expect(out.map((v) => v.id).sort()).toEqual(['v1', 'v2']);
  });

  it('MULTIPLO: OCR di un solo veicolo non tocca i venditori (con documenti) degli altri veicoli', () => {
    const prev: V[] = [
      base({ id: 'v1', veicoloOrdine: 1, cognome: 'ROSSI', nome: 'MARIO', cf: 'RSSMRA', identita: true }),
      base({ id: 'v2', veicoloOrdine: 2, cognome: 'VERDI', nome: 'LUIGI', cf: 'VRDLGU', identita: true }),
    ];
    // Prefill solo del veicolo 1 (veicolo 2 in OCR transitorio / non pronto).
    const prefill = [owner({ veicoloOrdine: 1, cognome: 'ROSSI', nome: 'MARIO', cf: 'RSSMRA', display: 'ROSSI MARIO' })];
    const out = reconcileVenditori(prev, prefill, opts());
    expect(out.map((v) => v.id).sort()).toEqual(['v1', 'v2']);
    expect(out.find((v) => v.id === 'v2')!.identita).toBe(true);
  });

  it('crea un nuovo venditore per un intestatario aggiuntivo, seminando l\'anagrafica', () => {
    const prev: V[] = [base({ id: 'blank1', veicoloOrdine: 1 })];
    const prefill = [
      owner({ cognome: 'ROSSI', nome: 'MARIO', cf: 'RSSMRA', display: 'ROSSI MARIO' }),
      owner({ cognome: 'BIANCHI', nome: 'ANNA', cf: 'BNCNNA', display: 'BIANCHI ANNA' }),
    ];
    const out = reconcileVenditori(prev, prefill, opts());
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('blank1'); // il primo riusa il blank
    expect(out[0].cognome).toBe('ROSSI');
    expect(out[1].id).toBe('new1'); // il secondo è nuovo
    expect(out[1].cognome).toBe('BIANCHI');
  });

  it('azienda: setta isPG e tipoSoggetto AZIENDA dalla ragione sociale', () => {
    const prev: V[] = [base({ id: 'blank1' })];
    const prefill = [owner({ isPersonaGiuridica: true, ragioneSociale: 'ACME SRL', piva: '01234567890', display: 'ACME SRL' })];
    const out = reconcileVenditori(prev, prefill, opts());
    expect(out[0].isPG).toBe(true);
    expect(out[0].tipoSoggetto).toBe('AZIENDA');
    expect(out[0].ragioneSociale).toBe('ACME SRL');
  });

  it('prefill vuoto: restituisce i venditori esistenti invariati (nessuna perdita)', () => {
    const prev: V[] = [base({ id: 'v1', cognome: 'ROSSI', identita: true })];
    const out = reconcileVenditori(prev, [], opts());
    expect(out).toEqual(prev);
  });
});
