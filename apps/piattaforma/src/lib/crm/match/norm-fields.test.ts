import { describe, it, expect } from 'vitest';
import { crmNormFields } from './norm-fields';

describe('crmNormFields', () => {
  it('produce le quattro colonne normalizzate', () => {
    expect(
      crmNormFields({
        tel: '+39 02 447 8712',
        wa: '+39 346 287 7310',
        email: ' Info@Agenzia.IT ',
        piva: 'IT 06199680155',
      }),
    ).toEqual({
      telNorm: '024478712',
      waNorm: '3462877310',
      emailNorm: 'info@agenzia.it',
      pivaNorm: '06199680155',
    });
  });

  it('mette null (non stringa vuota) quando il valore non è una chiave', () => {
    expect(crmNormFields({ tel: 'N/D', wa: null, email: '', piva: '123' })).toEqual({
      telNorm: null,
      waNorm: null,
      emailNorm: null,
      pivaNorm: null,
    });
  });
});
