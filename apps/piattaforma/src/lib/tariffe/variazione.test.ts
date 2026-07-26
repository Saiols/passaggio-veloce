import { describe, it, expect } from 'vitest';
import type { TariffaRow } from '@/lib/pricing';
import {
  PREAVVISO_LIEVE_GIORNI,
  PREAVVISO_RILEVANTE_GIORNI,
  calcolaVariazione,
  efficaciaDal,
  formatScostamentoBp,
  scostamentoBp,
} from './variazione';

/** Tariffa corrente di riferimento: i default legacy della piattaforma. */
const CORRENTE: TariffaRow = {
  sempliceFeeAgenziaCent: 7500,
  sempliceCreditoBrokerCent: 2500,
  sempliceAffiliazioneCent: 1000,
  minivolturaFeeAgenziaCent: 1500,
  minivolturaCreditoBrokerCent: 0,
  minivolturaAffiliazioneCent: 500,
};

const con = (over: Partial<TariffaRow>): TariffaRow => ({ ...CORRENTE, ...over });

describe('scostamentoBp', () => {
  it('calcola lo scostamento in punti base sul valore corrente', () => {
    expect(scostamentoBp(7500, 8250)).toBe(1000); // +10%
    expect(scostamentoBp(7500, 6750)).toBe(-1000); // -10%
  });

  it('voce invariata a zero → scostamento nullo, non indefinito', () => {
    expect(scostamentoBp(0, 0)).toBe(0);
  });

  it('voce che PARTE da zero → indefinito, non 0 e non infinito', () => {
    // Introdurre un compenso dove non ce n'era è la «modifica strutturale»
    // della clausola 3, non una variazione percentuale: chi legge `null` deve
    // trattarlo come rilevante. Restituire 0 farebbe passare per lieve
    // l'introduzione di una voce nuova.
    expect(scostamentoBp(0, 2500)).toBeNull();
  });
});

describe('calcolaVariazione — fascia lieve (fino al 20%, preavviso 7 giorni)', () => {
  it('aumento del 10% su una voce → LIEVE', () => {
    const v = calcolaVariazione(CORRENTE, con({ sempliceFeeAgenziaCent: 8250 }));
    expect(v.fascia).toBe('LIEVE');
    expect(v.giorniPreavviso).toBe(PREAVVISO_LIEVE_GIORNI);
    expect(v.richiedeRiaccettazione).toBe(false);
    expect(v.scostamentoMassimoBp).toBe(1000);
  });

  it('ESATTAMENTE il 20% → ancora LIEVE: la clausola dice «fino al 20%»', () => {
    // Confine contrattuale. Su aritmetica float 7500 * 1.2 può non dare
    // esattamente 9000: qui il calcolo è intero, quindi il confine non si
    // sposta mai di un centesimo.
    const v = calcolaVariazione(CORRENTE, con({ sempliceFeeAgenziaCent: 9000 }));
    expect(v.scostamentoMassimoBp).toBe(2000);
    expect(v.fascia).toBe('LIEVE');
  });

  it('un centesimo oltre il 20% → RILEVANTE', () => {
    const v = calcolaVariazione(CORRENTE, con({ sempliceFeeAgenziaCent: 9001 }));
    expect(v.fascia).toBe('RILEVANTE');
    expect(v.giorniPreavviso).toBe(PREAVVISO_RILEVANTE_GIORNI);
    expect(v.richiedeRiaccettazione).toBe(true);
  });

  it('una riduzione del 30% è rilevante quanto un aumento: conta il valore assoluto', () => {
    // Il contratto parla di «variazioni». In un tariffario a tre voci non
    // esiste una direzione sempre favorevole: abbassare il compenso del broker
    // lo danneggia esattamente come alzargli la fee.
    const v = calcolaVariazione(CORRENTE, con({ sempliceCreditoBrokerCent: 1750 }));
    // Il massimo è in valore assoluto (è ciò che si confronta con la soglia);
    // il verso resta leggibile sulla singola voce, che serve all'email.
    expect(v.scostamentoMassimoBp).toBe(3000);
    expect(v.voci[0].scostamentoBp).toBe(-3000);
    expect(v.fascia).toBe('RILEVANTE');
  });

  it('più voci variate → decide la più grande', () => {
    const v = calcolaVariazione(
      CORRENTE,
      con({ sempliceFeeAgenziaCent: 7650, sempliceAffiliazioneCent: 1300 }), // +2% e +30%
    );
    expect(v.voci).toHaveLength(2);
    expect(v.fascia).toBe('RILEVANTE');
    expect(v.scostamentoMassimoBp).toBe(3000);
  });
});

describe('calcolaVariazione — modifiche strutturali', () => {
  it('voce che passa da 0 a un importo → RILEVANTE anche se in euro è piccola', () => {
    // minivolturaCreditoBrokerCent parte da 0: dare 1€ al broker sulla
    // minivoltura è una tipologia di corrispettivo nuova, non un ritocco.
    const v = calcolaVariazione(CORRENTE, con({ minivolturaCreditoBrokerCent: 100 }));
    expect(v.fascia).toBe('RILEVANTE');
    expect(v.scostamentoMassimoBp).toBeNull();
    expect(v.richiedeRiaccettazione).toBe(true);
  });

  it('voce azzerata → -100%, quindi rilevante per la soglia', () => {
    const v = calcolaVariazione(CORRENTE, con({ sempliceAffiliazioneCent: 0 }));
    expect(v.scostamentoMassimoBp).toBe(10_000);
    expect(v.voci[0].scostamentoBp).toBe(-10_000);
    expect(v.fascia).toBe('RILEVANTE');
  });

  it("l'admin può dichiarare strutturale anche una variazione dell'1%", () => {
    const v = calcolaVariazione(CORRENTE, con({ sempliceFeeAgenziaCent: 7575 }), {
      strutturale: true,
    });
    expect(v.fascia).toBe('RILEVANTE');
    expect(v.giorniPreavviso).toBe(PREAVVISO_RILEVANTE_GIORNI);
    expect(v.strutturale).toBe(true);
  });
});

describe('calcolaVariazione — nessuna variazione di importi', () => {
  it('solo la nota cambia → NESSUNA fascia, efficacia immediata', () => {
    // Senza questo caso, correggere un refuso nella nota congelerebbe il
    // tariffario per una settimana e manderebbe un'email a tutti gli Utenti.
    const v = calcolaVariazione(CORRENTE, { ...CORRENTE });
    expect(v.fascia).toBe('NESSUNA');
    expect(v.voci).toEqual([]);
    expect(v.giorniPreavviso).toBe(0);
    expect(v.richiedeRiaccettazione).toBe(false);
  });

  it('ma se è dichiarata strutturale il preavviso lungo si applica lo stesso', () => {
    const v = calcolaVariazione(CORRENTE, { ...CORRENTE }, { strutturale: true });
    expect(v.fascia).toBe('RILEVANTE');
    expect(v.giorniPreavviso).toBe(PREAVVISO_RILEVANTE_GIORNI);
  });
});

describe('efficaciaDal', () => {
  it('somma i giorni di preavviso come tempo reale', () => {
    const now = new Date('2026-08-01T10:00:00.000Z');
    expect(efficaciaDal(now, 7).toISOString()).toBe('2026-08-08T10:00:00.000Z');
    expect(efficaciaDal(now, 30).toISOString()).toBe('2026-08-31T10:00:00.000Z');
  });

  it('attraverso il cambio dell’ora legale consegna comunque 7×24h piene', () => {
    // In Italia l'ora legale finisce il 25 ottobre 2026. Sommando 7 giorni di
    // CALENDARIO si otterrebbero 6 giorni e 23 ore di preavviso reale: un'ora
    // in meno del minimo promesso dalla clausola 3. Qui si sommano
    // millisecondi, quindi il minimo è sempre rispettato.
    const primaDelCambio = new Date('2026-10-22T12:00:00.000Z');
    const dopo = efficaciaDal(primaDelCambio, 7);
    expect(dopo.getTime() - primaDelCambio.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('preavviso 0 → efficacia immediata', () => {
    const now = new Date('2026-08-01T10:00:00.000Z');
    expect(efficaciaDal(now, 0).getTime()).toBe(now.getTime());
  });
});

describe('formatScostamentoBp', () => {
  it('rende una percentuale italiana leggibile, senza segno', () => {
    expect(formatScostamentoBp(1000)).toBe('10,00%');
    expect(formatScostamentoBp(-3000)).toBe('30,00%');
    expect(formatScostamentoBp(2050)).toBe('20,50%');
  });

  it('spiega il caso indefinito invece di stampare NaN', () => {
    expect(formatScostamentoBp(null)).toMatch(/non calcolabile/i);
  });
});
