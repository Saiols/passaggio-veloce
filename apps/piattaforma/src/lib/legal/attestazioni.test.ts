import { describe, it, expect } from 'vitest';
import {
  ATTESTAZIONI_VERSION,
  REGISTRO_ATTESTAZIONI,
  attestazioniPerVersione,
  attestazioniCorrenti,
} from './attestazioni';
import { ART_DATI_TERZI } from './clausole-vessatorie';

describe('registro delle attestazioni', () => {
  it('la versione corrente esiste nel registro', () => {
    expect(attestazioniPerVersione(ATTESTAZIONI_VERSION)).not.toBeNull();
  });

  // Il testo cita la clausola per NUMERO, scritto a mano nella stringa. Se i
  // Termini vengono rinumerati, questo test diventa rosso e obbliga ad aprire
  // una versione nuova invece di riscrivere in silenzio un testo gia'
  // persistito in migliaia di record.
  it('la versione corrente cita il numero di clausola attuale dei Termini', () => {
    const terzi = attestazioniCorrenti().find((a) => a.id === 'TERZI');
    expect(terzi).toBeDefined();
    expect(terzi!.testo).toContain(`clausola ${ART_DATI_TERZI} dei Termini`);
  });

  it('la versione corrente ha esattamente le due spunte separate', () => {
    expect(attestazioniCorrenti().map((a) => a.id)).toEqual(['RESPONSABILITA', 'TERZI']);
  });

  it("l'attestazione sui terzi rimanda all'informativa clienti", () => {
    const terzi = attestazioniCorrenti().find((a) => a.id === 'TERZI')!;
    expect(terzi.link?.href).toBe('/privacy/clienti');
    expect(terzi.testo).toContain('passaggioveloce.it/privacy/clienti');
  });

  it('ogni versione ha id univoci', () => {
    for (const [versione, atts] of Object.entries(REGISTRO_ATTESTAZIONI)) {
      const ids = atts.map((a) => a.id);
      expect(new Set(ids).size, `id duplicati in ${versione}`).toBe(ids.length);
    }
  });

  it('CUMULATIVA esiste solo nelle versioni storiche, mai in quella corrente', () => {
    expect(attestazioniCorrenti().some((a) => a.id === 'CUMULATIVA')).toBe(false);
    expect(attestazioniPerVersione('v3.1')!.map((a) => a.id)).toEqual(['CUMULATIVA']);
  });

  // Snapshot: le versioni storiche descrivono cosa un utente HA GIA' letto e
  // spuntato. Modificarle riscriverebbe il passato.
  it('v3.0 e v3.1 sono congelate e citano clausole diverse', () => {
    expect(attestazioniPerVersione('v3.0')![0].testo).toContain('clausola 17 dei Termini');
    expect(attestazioniPerVersione('v3.1')![0].testo).toContain('clausola 23 dei Termini');
  });

  it('una versione sconosciuta non viene inventata', () => {
    expect(attestazioniPerVersione('v9.9')).toBeNull();
    expect(attestazioniPerVersione('')).toBeNull();
  });
});
