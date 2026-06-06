import { describe, it, expect } from 'vitest';
import { docKey, parteToOwner, requiredUploadDocs, docLabel } from './richiesti';
import type { DocumentoRichiesto } from './engine';

const libretto: DocumentoRichiesto = { tipo: 'LIBRETTO_CIRCOLAZIONE', parte: 'VEICOLO', motivo: '', veicoloOrdine: 1 };
const cdp: DocumentoRichiesto = { tipo: 'CERTIFICATO_PROPRIETA', parte: 'VEICOLO', motivo: '', veicoloOrdine: 2 };
const ciVend: DocumentoRichiesto = { tipo: 'CI_FRONTE', parte: 'VENDITORE', motivo: '' };

describe('docKey', () => {
  it('chiave stabile tipo__parte__veicoloOrdine', () => {
    expect(docKey(cdp)).toBe('CERTIFICATO_PROPRIETA__VEICOLO__2');
    expect(docKey(ciVend)).toBe('CI_FRONTE__VENDITORE__0');
  });
});
describe('requiredUploadDocs', () => {
  it('esclude il libretto e tiene il resto', () => {
    const r = requiredUploadDocs({ kind: 'OK', documentiRichiesti: [libretto, cdp, ciVend] });
    expect(r.map((d) => d.tipo)).toEqual(['CERTIFICATO_PROPRIETA', 'CI_FRONTE']);
  });
  it('[] se non OK', () => {
    expect(requiredUploadDocs({ kind: 'BLOCCO', motivo: 'x', soluzione: 'y' })).toEqual([]);
  });
});
describe('parteToOwner', () => {
  it('mappa al lato corretto', () => {
    expect(parteToOwner('VENDITORE')).toBe('VENDITORE');
    expect(parteToOwner('AMMINISTRATORE_VENDITORE')).toBe('VENDITORE');
    expect(parteToOwner('ACQUIRENTE')).toBe('ACQUIRENTE');
    expect(parteToOwner('AMMINISTRATORE_ACQUIRENTE')).toBe('ACQUIRENTE');
    expect(parteToOwner('VEICOLO')).toBeNull();
    expect(parteToOwner('PROCURATORE')).toBeNull();
  });
});
describe('docLabel', () => {
  it('etichetta leggibile', () => {
    expect(docLabel(cdp)).toBe('Certificato di Proprietà — Veicolo 2');
    expect(docLabel(ciVend)).toBe("Carta d'identità (fronte) — Venditore");
  });
});
