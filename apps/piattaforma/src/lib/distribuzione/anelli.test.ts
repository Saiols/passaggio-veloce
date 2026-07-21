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
});
