import { describe, it, expect } from 'vitest';
import { toggle, toggleCategoria, applicaPreset, permessiConcedibili } from './matrice-logic';
import { permessiPerTipo, type Permesso } from '@/lib/auth/permessi/catalogo';
import { preset } from '@/lib/auth/permessi/preset';

const tutti = new Set<Permesso>(permessiPerTipo('AGENZIA'));

describe('toggle', () => {
  it('accendendo un figlio si accende il padre', () => {
    expect(toggle([], 'fatture.download', tutti)).toEqual(['fatture.download', 'fatture.view']);
  });

  it('accendendo un figlio si accende il padre anche in altre categorie', () => {
    expect(toggle([], 'sede.edit', tutti)).toEqual(['sede.edit', 'sede.view']);
  });

  it('spegnendo il padre si spengono i figli', () => {
    // La terza chiave dietro `sede.edit` è uscita dai delegabili (2026-07-10):
    // nel catalogo non esistono più catene a tre livelli. La cascata resta
    // ricorsiva, ma qui la si esercita su due livelli, gli unici che il
    // catalogo offre.
    expect(toggle(['sede.view', 'sede.edit'], 'sede.view', tutti)).toEqual([]);
    expect(toggle(['orari.view', 'orari.edit'], 'orari.view', tutti)).toEqual([]);
  });

  it('spegnendo un figlio non tocca il padre', () => {
    expect(toggle(['fatture.view', 'fatture.download'], 'fatture.download', tutti)).toEqual([
      'fatture.view',
    ]);
  });

  it('non concede un figlio se il padre non è assegnabile', () => {
    // Chi non può dare `fatture.view` non può dare `fatture.download`: il set
    // risultante sarebbe incoerente e il server lo rifiuterebbe comunque.
    const puoi = new Set<Permesso>(permessiPerTipo('AGENZIA').filter((p) => p !== 'fatture.view'));
    expect(toggle([], 'fatture.download', puoi)).toEqual([]);
  });

  it('non muta il valore in ingresso', () => {
    const value: Permesso[] = ['fatture.view'];
    toggle(value, 'fatture.download', tutti);
    expect(value).toEqual(['fatture.view']);
  });
});

describe('toggleCategoria', () => {
  it('accende tutta la categoria coi suoi padri', () => {
    const out = toggleCategoria([], 'fatture', 'AGENZIA', tutti);
    expect(out).toEqual(['fatture.download', 'fatture.view', 'fatture.xml']);
  });

  it('se è già tutta accesa la spegne', () => {
    const piena: Permesso[] = ['fatture.view', 'fatture.download', 'fatture.xml'];
    expect(toggleCategoria(piena, 'fatture', 'AGENZIA', tutti)).toEqual([]);
  });

  it('da parziale accende il resto', () => {
    expect(toggleCategoria(['fatture.view'], 'fatture', 'AGENZIA', tutti)).toEqual([
      'fatture.download',
      'fatture.view',
      'fatture.xml',
    ]);
  });

  it('salta i permessi non assegnabili', () => {
    const puoi = new Set<Permesso>(permessiPerTipo('AGENZIA').filter((p) => p !== 'fatture.xml'));
    expect(toggleCategoria([], 'fatture', 'AGENZIA', puoi)).toEqual([
      'fatture.download',
      'fatture.view',
    ]);
  });

  it('una categoria inesistente lascia il valore intatto', () => {
    expect(toggleCategoria(['fatture.view'], 'inbox', 'DEALER', tutti)).toEqual(['fatture.view']);
  });
});

describe('applicaPreset', () => {
  it('applica il preset intero quando tutto è assegnabile', () => {
    expect(applicaPreset('OPERATORE_BASE', 'AGENZIA', tutti)).toEqual(
      [...preset('OPERATORE_BASE', 'AGENZIA')].sort(),
    );
  });

  it('scarta dal preset ciò che il chiamante non può concedere', () => {
    const puoi = new Set<Permesso>(permessiPerTipo('AGENZIA').filter((p) => p !== 'inbox.gestisci'));
    expect(applicaPreset('OPERATORE_BASE', 'AGENZIA', puoi)).not.toContain('inbox.gestisci');
  });
});

describe('permessiConcedibili', () => {
  it("a un OPERATORE non si possono concedere permessi team: manageableSedi() lo blocca comunque", () => {
    const out = permessiConcedibili([...tutti], 'OPERATORE');
    expect([...out].filter((p) => p.startsWith('team.'))).toEqual([]);
    expect(out.has('pratiche.view')).toBe(true);
  });

  it('a un ADMIN_SEDE i permessi team restano concedibili', () => {
    const out = permessiConcedibili([...tutti], 'ADMIN_SEDE');
    expect(out.has('team.crea')).toBe(true);
    expect(out.has('team.permessi')).toBe(true);
  });

  it('non aggiunge nulla che il chiamante non avesse già', () => {
    const parziale: Permesso[] = ['pratiche.view', 'team.view'];
    expect([...permessiConcedibili(parziale, 'ADMIN_SEDE')].sort()).toEqual(parziale.sort());
  });

  it('applicaPreset ADMIN_SEDE su un operatore non accende i team.*', () => {
    const puoi = permessiConcedibili([...tutti], 'OPERATORE');
    expect(applicaPreset('ADMIN_SEDE', 'AGENZIA', puoi).filter((p) => p.startsWith('team.'))).toEqual([]);
  });
});
