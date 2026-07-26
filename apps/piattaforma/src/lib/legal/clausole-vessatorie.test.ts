import { describe, it, expect } from 'vitest';
import {
  ART_APPROVAZIONE_SPECIFICA,
  ART_DATI_TERZI,
  CLAUSOLE_VESSATORIE,
  DESCRIZIONI_VESSATORIE,
  TERMS_VERSION,
  elencoClausoleVessatorie,
  elencoDescrizioniVessatorie,
} from './clausole-vessatorie';

describe('clausole vessatorie', () => {
  it('elenca le clausole approvate specificamente ex 1341/1342', () => {
    expect([...CLAUSOLE_VESSATORIE]).toEqual([3, 5, 6, 7, 8, 10, 11, 12, 13, 15, 16, 23, 24]);
  });

  it("l'articolo di approvazione specifica è il 25", () => {
    expect(ART_APPROVAZIONE_SPECIFICA).toBe(25);
  });

  it("nessuna clausola vessatoria coincide o supera l'articolo di approvazione", () => {
    // Un elenco che citasse se stesso (o un articolo inesistente) sarebbe un
    // contratto che si contraddice: qui si rompe il test, non il contratto.
    for (const n of CLAUSOLE_VESSATORIE) {
      expect(n).toBeLessThan(ART_APPROVAZIONE_SPECIFICA);
      expect(n).toBeGreaterThan(0);
    }
  });

  it("l'elenco è ordinato e senza duplicati", () => {
    const arr = [...CLAUSOLE_VESSATORIE];
    expect(arr).toEqual([...new Set(arr)].sort((a, b) => a - b));
  });

  it('rende l\'elenco come stringa leggibile per la checkbox', () => {
    expect(elencoClausoleVessatorie()).toBe('3, 5, 6, 7, 8, 10, 11, 12, 13, 15, 16, 23, 24');
  });

  it('la versione dei Termini è una data ISO', () => {
    expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('le descrizioni coprono esattamente CLAUSOLE_VESSATORIE (né in meno né in più)', () => {
    // Se manca una chiave, `app/termini/page.tsx` renderizza `undefined` per
    // quella clausola. Se ne avanza una, è la descrizione di una clausola che
    // non è (più) vessatoria: un fossile di una vecchia numerazione. Nessuno
    // dei due casi va bene, e nessun test precedente lo catturava — solo
    // l'occhio, prima di questo test.
    const chiaviAttese = [...CLAUSOLE_VESSATORIE].sort((a, b) => a - b);
    const chiaviDescrizioni = Object.keys(DESCRIZIONI_VESSATORIE)
      .map(Number)
      .sort((a, b) => a - b);
    expect(chiaviDescrizioni).toEqual(chiaviAttese);
  });

  it('la 23 è la garanzia/manleva sui dati dei terzi e la 24 è il foro (non invertite)', () => {
    // Rinumerando, il rischio non è perdere una chiave — il test sopra lo
    // vedrebbe — ma lasciarla attaccata alla descrizione vecchia: l'elenco
    // dell'approvazione specifica direbbe "Clausola 23 — foro competente"
    // mentre la 23 dei Termini parla di dati personali di terzi.
    expect(DESCRIZIONI_VESSATORIE[23]).toMatch(/dati di venditori e acquirenti/i);
    expect(DESCRIZIONI_VESSATORIE[24]).toMatch(/foro/i);
  });

  it('ART_DATI_TERZI punta alla clausola descritta come dati di venditori e acquirenti', () => {
    // `ART_DATI_TERZI` è il numero mostrato nella checkbox del popup broker e
    // tracciato in `BrokerDichiarazione`. Alla rinumerazione del 2026-07-26
    // (17→23) è bastato dimenticarlo per far dichiarare al broker di aver
    // informato i clienti "ai sensi della clausola 17" — che nei Termini v8 è
    // il divieto di cessione del contratto. Qui i due valori non possono più
    // divergere.
    expect(DESCRIZIONI_VESSATORIE[ART_DATI_TERZI as 23]).toMatch(
      /dati di venditori e acquirenti/i,
    );
  });

  it('la prosa descrittiva della checkbox copre TUTTE le clausole elencate', () => {
    // La checkbox di registrazione mostrava i numeri generati dalla fonte
    // unica ma una parentesi descrittiva scritta a mano. Alla decima clausola
    // avrebbe elencato 10 numeri e 9 descrizioni: l'utente approverebbe
    // "specificamente" (art. 1341 c.c.) una clausola che la checkbox non
    // nomina. Da qui in poi la prosa è generata: non può più divergere.
    const prosa = elencoDescrizioniVessatorie();
    for (const n of CLAUSOLE_VESSATORIE) {
      expect(prosa).toContain(DESCRIZIONI_VESSATORIE[n]);
    }
  });
});
