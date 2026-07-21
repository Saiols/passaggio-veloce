import { describe, it, expect } from 'vitest';
import { prossimoAnello, type SedeConDistanza } from './anelli';
import { DISTRIBUZIONE_DEFAULT } from './config';

// cfg default v2: start 500, step 200, max 10000 (irrilevante qui: prossimoAnello
// usa solo stepM e raggioMaxM, raggioStartM è responsabilità del chiamante).
const cfg = DISTRIBUZIONE_DEFAULT;

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
