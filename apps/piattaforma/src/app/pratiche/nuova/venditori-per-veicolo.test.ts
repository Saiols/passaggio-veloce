import { describe, it, expect } from 'vitest';
import { intestatariPerVeicolo, crossCheckPerVeicolo } from './venditori-per-veicolo';
import type { OwnerInfo } from '@/lib/providers/ocr/types';

const owner = (o: Partial<OwnerInfo>): OwnerInfo => ({
  isPersonaGiuridica: false,
  display: '',
  ...o,
});

const v1 = {
  ocr: {
    proprietariInfo: [
      owner({ cognome: 'ROSSI', nome: 'MARIO', display: 'ROSSI MARIO' }),
      owner({ cognome: 'ROSSI', nome: 'LUCIA', display: 'ROSSI LUCIA' }),
    ],
  },
};
const v2 = {
  ocr: {
    proprietariInfo: [
      owner({ isPersonaGiuridica: true, ragioneSociale: 'ACME SRL', piva: '12345678901', display: 'ACME SRL' }),
    ],
  },
};

describe('intestatariPerVeicolo', () => {
  it('un venditore per intestatario di ciascun veicolo, taggato veicoloOrdine', () => {
    const r = intestatariPerVeicolo([v1, v2]);
    expect(r.map((x) => x.veicoloOrdine)).toEqual([1, 1, 2]);
    expect(r[0]).toMatchObject({ cognome: 'ROSSI', nome: 'MARIO', isPersonaGiuridica: false, veicoloOrdine: 1 });
    expect(r[2]).toMatchObject({ ragioneSociale: 'ACME SRL', piva: '12345678901', isPersonaGiuridica: true, veicoloOrdine: 2 });
  });

  it('stesso intestatario su 2 veicoli = 2 voci (no dedup)', () => {
    const same = { ocr: { proprietariInfo: [owner({ cognome: 'ROSSI', nome: 'MARIO', display: 'ROSSI MARIO' })] } };
    const r = intestatariPerVeicolo([same, same]);
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.veicoloOrdine)).toEqual([1, 2]);
  });

  it('veicolo senza OCR → nessun intestatario', () => {
    expect(intestatariPerVeicolo([{}, v2])).toHaveLength(1);
  });
});

describe('crossCheckPerVeicolo', () => {
  it('OK se ogni veicolo combacia', () => {
    const venditori = [
      { veicoloOrdine: 1, isPG: false, nome: 'MARIO', cognome: 'ROSSI' },
      { veicoloOrdine: 1, isPG: false, nome: 'LUCIA', cognome: 'ROSSI' },
      { veicoloOrdine: 2, isPG: true, ragioneSociale: 'ACME SRL' },
    ];
    const proprietariPerVeicolo = { 1: ['ROSSI MARIO', 'ROSSI LUCIA'], 2: ['ACME SRL'] };
    expect(crossCheckPerVeicolo(venditori, proprietariPerVeicolo)).toBe('OK');
  });

  it('MISMATCH se un solo veicolo non combacia', () => {
    const venditori = [
      { veicoloOrdine: 1, isPG: false, nome: 'MARIO', cognome: 'ROSSI' },
      { veicoloOrdine: 2, isPG: false, nome: 'LUCA', cognome: 'BIANCHI' },
    ];
    const proprietariPerVeicolo = { 1: ['ROSSI MARIO'], 2: ['VERDI GIUSEPPE'] };
    expect(crossCheckPerVeicolo(venditori, proprietariPerVeicolo)).toBe('MISMATCH');
  });

  it('SCONOSCIUTO se nessun veicolo ha proprietari noti', () => {
    const venditori = [{ veicoloOrdine: 1, isPG: false, nome: 'MARIO', cognome: 'ROSSI' }];
    expect(crossCheckPerVeicolo(venditori, {})).toBe('SCONOSCIUTO');
  });

  it('MISMATCH se un veicolo ha intestatari noti ma NESSUN venditore assegnato (bug #8)', () => {
    // Il veicolo 2 ha intestatari letti dall'OCR ma nessun venditore (rimosso a
    // mano). Prima passava come OK (mai controllato); ora deve bloccare.
    const venditori = [{ veicoloOrdine: 1, isPG: false, nome: 'MARIO', cognome: 'ROSSI' }];
    const proprietariPerVeicolo = { 1: ['ROSSI MARIO'], 2: ['VERDI GIUSEPPE'] };
    expect(crossCheckPerVeicolo(venditori, proprietariPerVeicolo)).toBe('MISMATCH');
  });

  it('un veicolo con intestatari vuoti non genera MISMATCH spurio', () => {
    const venditori = [{ veicoloOrdine: 1, isPG: false, nome: 'MARIO', cognome: 'ROSSI' }];
    const proprietariPerVeicolo = { 1: ['ROSSI MARIO'], 2: [] };
    expect(crossCheckPerVeicolo(venditori, proprietariPerVeicolo)).toBe('OK');
  });
});
