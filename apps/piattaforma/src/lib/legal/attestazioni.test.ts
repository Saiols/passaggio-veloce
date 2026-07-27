import { describe, it, expect } from 'vitest';
import {
  ATTESTAZIONI_VERSION,
  REGISTRO_ATTESTAZIONI,
  attestazioniPerVersione,
  attestazioniCorrenti,
  tutteLeAttestazioniAccettate,
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

  // Finding 2 (review whole-branch 2026-07-27): `clausolaTerzi` va scritto
  // insieme al testo, DENTRO il registro versionato — mai dalla costante viva
  // importata a parte da chi scrive il record (altrimenti mezzo record e'
  // congelato alla versione, mezzo e' "attuale al momento della scrittura", e
  // i due possono contraddirsi). Il registro deve comunque concordare con la
  // costante viva PER LA VERSIONE CORRENTE: se questo test diventa rosso dopo
  // una rinumerazione, e' il segnale che bisogna aprire una versione nuova
  // (bumpare ATTESTAZIONI_VERSION), non solo la costante.
  it('il clausolaTerzi della versione corrente concorda con ART_DATI_TERZI', () => {
    expect(REGISTRO_ATTESTAZIONI[ATTESTAZIONI_VERSION]!.clausolaTerzi).toBe(ART_DATI_TERZI);
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
    for (const [versione, v] of Object.entries(REGISTRO_ATTESTAZIONI)) {
      const ids = v.attestazioni.map((a) => a.id);
      expect(new Set(ids).size, `id duplicati in ${versione}`).toBe(ids.length);
    }
  });

  it('CUMULATIVA esiste solo nelle versioni storiche, mai in quella corrente', () => {
    expect(attestazioniCorrenti().some((a) => a.id === 'CUMULATIVA')).toBe(false);
    expect(attestazioniPerVersione('v3.1')!.attestazioni.map((a) => a.id)).toEqual([
      'CUMULATIVA',
    ]);
  });

  // Snapshot: le versioni storiche descrivono cosa un utente HA GIA' letto e
  // spuntato. Modificarle riscriverebbe il passato. Include il numero di
  // clausola: v3.0 e v3.1 citano numeri diversi, non solo testi diversi.
  it('v3.0 e v3.1 sono congelate e citano clausole diverse (testo e clausolaTerzi)', () => {
    expect(attestazioniPerVersione('v3.0')!.attestazioni[0]!.testo).toContain(
      'clausola 17 dei Termini',
    );
    expect(attestazioniPerVersione('v3.0')!.clausolaTerzi).toBe(17);
    expect(attestazioniPerVersione('v3.1')!.attestazioni[0]!.testo).toContain(
      'clausola 23 dei Termini',
    );
    expect(attestazioniPerVersione('v3.1')!.clausolaTerzi).toBe(23);
  });

  it('una versione sconosciuta non viene inventata', () => {
    expect(attestazioniPerVersione('v9.9')).toBeNull();
    expect(attestazioniPerVersione('')).toBeNull();
  });

  // La versione arriva dal client (FormData field, max 20 char). Una versione
  // ignota deve produrre un rifiuto pulito, non un TypeError piu' a valle.
  // Protezione contro prototype pollution: Object.prototype members come
  // 'constructor', 'toString', 'hasOwnProperty', '__proto__' vanno trattate
  // come versioni sconosciute, non come funzioni ereditate.
  it('versioni ereditate da Object.prototype restituiscono null', () => {
    expect(attestazioniPerVersione('constructor')).toBeNull();
    expect(attestazioniPerVersione('toString')).toBeNull();
    expect(attestazioniPerVersione('hasOwnProperty')).toBeNull();
    expect(attestazioniPerVersione('__proto__')).toBeNull();
  });

  // Finding 3 (review whole-branch 2026-07-27): il requisito sui flag deve
  // essere derivato da QUALI attestazioni porta la versione dichiarata, non
  // scritto a mano nel chiamante. Un browser che tiene ancora un bundle
  // precedente (es. v3.1, una sola spunta cumulativa) non puo' fisicamente
  // mandare un campo che non esisteva ancora — validarlo contro un requisito
  // fisso da due spunte lo respingerebbe a torto.
  describe('tutteLeAttestazioniAccettate', () => {
    it('v4.0 (due spunte separate) richiede entrambi i flag', () => {
      const { attestazioni } = attestazioniPerVersione('v4.0')!;
      expect(
        tutteLeAttestazioniAccettate(attestazioni, {
          dichiarazioneAccettata: true,
          attestazioneTerziAccettata: false,
        }),
      ).toBe(false);
      expect(
        tutteLeAttestazioniAccettate(attestazioni, {
          dichiarazioneAccettata: false,
          attestazioneTerziAccettata: true,
        }),
      ).toBe(false);
      expect(
        tutteLeAttestazioniAccettate(attestazioni, {
          dichiarazioneAccettata: true,
          attestazioneTerziAccettata: true,
        }),
      ).toBe(true);
    });

    it('v3.1 (una sola spunta cumulativa) non richiede attestazioneTerziAccettata', () => {
      const { attestazioni } = attestazioniPerVersione('v3.1')!;
      // Payload che un client v3.1 reale produce davvero: il campo terzi non
      // esisteva ancora nel form, quindi arriva `false` (assente → default),
      // non `true`. Deve comunque bastare.
      expect(
        tutteLeAttestazioniAccettate(attestazioni, {
          dichiarazioneAccettata: true,
          attestazioneTerziAccettata: false,
        }),
      ).toBe(true);
      expect(
        tutteLeAttestazioniAccettate(attestazioni, {
          dichiarazioneAccettata: false,
          attestazioneTerziAccettata: false,
        }),
      ).toBe(false);
    });
  });
});
