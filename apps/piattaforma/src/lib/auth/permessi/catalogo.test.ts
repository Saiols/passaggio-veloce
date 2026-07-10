import { describe, it, expect } from 'vitest';
import {
  CATALOGO,
  PERMESSI,
  catalogoPerTipo,
  permessiPerTipo,
  isPermesso,
  dipendenzaDi,
  conDipendenze,
} from './catalogo';

describe('catalogo permessi', () => {
  it('un dealer ha 23 permessi, un agenzia 31', () => {
    expect(permessiPerTipo('DEALER')).toHaveLength(23);
    expect(permessiPerTipo('AGENZIA')).toHaveLength(31);
  });

  it('le categorie solo-agenzia non compaiono per un dealer', () => {
    const idsDealer = catalogoPerTipo('DEALER').map((c) => c.id);
    expect(idsDealer).not.toContain('inbox');
    expect(idsDealer).not.toContain('pagamenti');
    expect(catalogoPerTipo('AGENZIA').map((c) => c.id)).toContain('inbox');
  });

  it('i permessi solo-dealer non compaiono per un agenzia', () => {
    expect(permessiPerTipo('AGENZIA')).not.toContain('pratiche.create');
    expect(permessiPerTipo('DEALER')).toContain('pratiche.create');
    expect(permessiPerTipo('DEALER')).not.toContain('pratiche.firma');
  });

  it('ogni chiave del catalogo è unica', () => {
    const chiavi = CATALOGO.flatMap((c) => c.permessi.map((p) => p.chiave));
    expect(new Set(chiavi).size).toBe(chiavi.length);
  });

  it('PERMESSI e CATALOGO non divergono', () => {
    // `Permesso` deriva dalla tupla PERMESSI; il CATALOGO è la sua descrizione.
    // Se le due liste si separano, il tipo mente. Questo test lo impedisce.
    const chiavi = CATALOGO.flatMap((c) => c.permessi.map((p) => p.chiave));
    expect([...chiavi].sort()).toEqual([...PERMESSI].sort());
  });

  it('ogni dipendenza punta a una chiave esistente e dello stesso companyType', () => {
    for (const t of ['DEALER', 'AGENZIA'] as const) {
      const chiavi = permessiPerTipo(t);
      for (const p of chiavi) {
        const dip = dipendenzaDi(p);
        if (dip) expect(chiavi).toContain(dip);
      }
    }
  });

  it('isPermesso rifiuta una chiave inventata', () => {
    expect(isPermesso('pratiche.view')).toBe(true);
    expect(isPermesso('pratiche.tuttofare')).toBe(false);
  });

  it('conDipendenze risale la catena fino alla radice', () => {
    // sede.iban → sede.edit → sede.view
    expect(conDipendenze(['sede.iban']).sort()).toEqual(
      ['sede.edit', 'sede.iban', 'sede.view'].sort(),
    );
    // fatture.download → fatture.view
    expect(conDipendenze(['fatture.download']).sort()).toEqual(
      ['fatture.download', 'fatture.view'].sort(),
    );
  });

  it('le sei azioni sensibili sono marcate', () => {
    const sensibili = CATALOGO.flatMap((c) => c.permessi)
      .filter((p) => p.sensibile)
      .map((p) => p.chiave)
      .sort();
    expect(sensibili).toEqual(
      [
        'pagamenti.iban',
        'pratiche.firma',
        'pratiche.segnala',
        'sede.iban',
        'team.permessi',
        'wallet.payout',
      ].sort(),
    );
  });
});
