import { describe, it, expect } from 'vitest';
import { primoAnello, prossimoAnello, type SedeConDistanza } from './anelli';
import type { DistribuzioneConfigDTO } from './config';
import { CALENDARIO_DEFAULT } from './calendario';

/**
 * Config esplicita, NON `DISTRIBUZIONE_DEFAULT`: i valori di default sono
 * editabili da admin e cambiarli non deve rendere falsi questi test, che
 * verificano la meccanica degli anelli. `raggioStartM` (500) è diverso da
 * `stepM` (200) apposta: così i test distinguono il primo anello dai successivi.
 * Il calendario è irrilevante qui (`prossimoAnello` non lo legge): preso da
 * `CALENDARIO_DEFAULT` solo per soddisfare la forma del DTO.
 */
const cfg: DistribuzioneConfigDTO = {
  raggioStartM: 500,
  stepM: 200,
  raggioMaxM: 10000,
  intervalloMin: 60,
  ...CALENDARIO_DEFAULT,
};

describe('prossimoAnello', () => {
  it('sede a 650m con raggioCorrente=500 → notifica al primo anello che la include (700)', () => {
    const sede: SedeConDistanza = { sedeId: 's1', companyId: 'c1', distanzaM: 650 };

    const esito = prossimoAnello([sede], 500, cfg);

    expect(esito).toEqual({ tipo: 'notifica', raggioRaggiuntoM: 700, sedi: [sede] });
  });

  it('sede unica a 1150m: skippa gli anelli vuoti 700/900/1100 e notifica a 1300', () => {
    const sede: SedeConDistanza = { sedeId: 's2', companyId: 'c2', distanzaM: 1150 };

    const esito = prossimoAnello([sede], 500, cfg);

    expect(esito).toEqual({ tipo: 'notifica', raggioRaggiuntoM: 1300, sedi: [sede] });
  });

  it('nessuna sede entro il raggio massimo → zona-non-coperta al raggioMaxM', () => {
    const esito = prossimoAnello([], 500, cfg);

    expect(esito).toEqual({ tipo: 'zona-non-coperta', raggioRaggiuntoM: cfg.raggioMaxM });
  });

  it('raggioCorrente già al raggioMaxM con sedi residue oltre → non può avanzare, zona-non-coperta', () => {
    const sedeOltre: SedeConDistanza = { sedeId: 's3', companyId: 'c3', distanzaM: cfg.raggioMaxM + 5000 };

    const esito = prossimoAnello([sedeOltre], cfg.raggioMaxM, cfg);

    expect(esito).toEqual({ tipo: 'zona-non-coperta', raggioRaggiuntoM: cfg.raggioMaxM });
  });

  it('config malformata stepM:0 → TERMINA (zona-non-coperta), niente loop infinito', () => {
    // stepM<=0 farebbe non avanzare mai il raggio: il clamp interno a ≥1 m
    // garantisce la terminazione. raggioMaxM piccolo per un test istantaneo.
    const cfgRotta = { ...cfg, stepM: 0, raggioMaxM: 1000 };

    const esito = prossimoAnello([], 500, cfgRotta);

    expect(esito).toEqual({ tipo: 'zona-non-coperta', raggioRaggiuntoM: 1000 });
  });

  it('config malformata stepM:0 con una sede in zona → notifica (avanza a passo 1 m)', () => {
    const cfgRotta = { ...cfg, stepM: 0, raggioMaxM: 1000 };
    const sede: SedeConDistanza = { sedeId: 's9', companyId: 'c9', distanzaM: 600 };

    const esito = prossimoAnello([sede], 599, cfgRotta);

    // Con clamp step=1 m, il primo anello che include la sede a 600 è 600.
    expect(esito).toEqual({ tipo: 'notifica', raggioRaggiuntoM: 600, sedi: [sede] });
  });
});

describe('primoAnello', () => {
  it('sede entro il raggio iniziale → notifica a raggioStartM, NON a stepM', () => {
    const sede: SedeConDistanza = { sedeId: 's1', companyId: 'c1', distanzaM: 450 };

    const esito = primoAnello([sede], cfg);

    // 200 (stepM) escluderebbe la sede: il primo anello vale raggioStartM.
    expect(esito).toEqual({ tipo: 'notifica', raggioRaggiuntoM: 500, sedi: [sede] });
  });

  it('raggio iniziale vuoto → prosegue a step nello stesso calcolo (sede a 650 → 700)', () => {
    const sede: SedeConDistanza = { sedeId: 's2', companyId: 'c2', distanzaM: 650 };

    const esito = primoAnello([sede], cfg);

    expect(esito).toEqual({ tipo: 'notifica', raggioRaggiuntoM: 700, sedi: [sede] });
  });

  it('include tutte le sedi entro il raggio raggiunto, non solo la più vicina', () => {
    const vicina: SedeConDistanza = { sedeId: 'sA', companyId: 'cA', distanzaM: 100 };
    const media: SedeConDistanza = { sedeId: 'sB', companyId: 'cB', distanzaM: 480 };
    const oltre: SedeConDistanza = { sedeId: 'sC', companyId: 'cC', distanzaM: 900 };

    const esito = primoAnello([vicina, media, oltre], cfg);

    expect(esito).toEqual({
      tipo: 'notifica',
      raggioRaggiuntoM: 500,
      sedi: [vicina, media],
    });
  });

  it('nessuna sede entro il raggio massimo → zona-non-coperta', () => {
    const esito = primoAnello([], cfg);

    expect(esito).toEqual({ tipo: 'zona-non-coperta', raggioRaggiuntoM: cfg.raggioMaxM });
  });
});
