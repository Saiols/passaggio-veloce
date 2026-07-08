import { describe, expect, it } from 'vitest';
import {
  toSedeScope,
  whereFeeAddebito,
  whereValutazione,
  wherePraticaAttiva,
  whereAssegnazionePending,
  whereDocumentoFiscale,
} from './scope-filters';

const OWNER_ALL = { isOwner: true, scopeIds: ['s1', 's2'], currentSede: { kind: 'ALL' as const } };
const OWNER_ONE = {
  isOwner: true,
  scopeIds: ['s1'],
  currentSede: { kind: 'ONE' as const, sede: { id: 's1' } },
};
const MEMBRO = {
  isOwner: false,
  scopeIds: ['s2'],
  currentSede: { kind: 'ONE' as const, sede: { id: 's2' } },
};
const SENZA_SEDI = { isOwner: false, scopeIds: [], currentSede: null };

describe('toSedeScope', () => {
  it('aggrega solo per il proprietario in vista ALL', () => {
    expect(toSedeScope(OWNER_ALL)).toEqual({ scopeIds: ['s1', 's2'], aggregate: true });
    expect(toSedeScope(OWNER_ONE)).toEqual({ scopeIds: ['s1'], aggregate: false });
    expect(toSedeScope(MEMBRO)).toEqual({ scopeIds: ['s2'], aggregate: false });
    expect(toSedeScope(SENZA_SEDI)).toEqual({ scopeIds: [], aggregate: false });
  });
});

describe('whereFeeAddebito', () => {
  it("owner aggregato: tutta la madre (include le righe legacy senza sede)", () => {
    expect(whereFeeAddebito(toSedeScope(OWNER_ALL), 'c1')).toEqual({ agenziaId: 'c1' });
  });

  it('membro: solo le sedi in scope, sempre dentro la madre', () => {
    expect(whereFeeAddebito(toSedeScope(MEMBRO), 'c1')).toEqual({
      agenziaId: 'c1',
      agenziaSedeId: { in: ['s2'] },
    });
  });

  it('senza sedi accessibili: fail-closed, nessuna riga', () => {
    expect(whereFeeAddebito(toSedeScope(SENZA_SEDI), 'c1')).toEqual({
      agenziaId: 'c1',
      agenziaSedeId: { in: [] },
    });
  });
});

describe('whereValutazione', () => {
  it('membro: feedback della sola sede', () => {
    expect(whereValutazione(toSedeScope(MEMBRO), 'c1')).toEqual({
      agenziaId: 'c1',
      agenziaSedeId: { in: ['s2'] },
    });
  });

  it('owner aggregato: nessun filtro sede', () => {
    expect(whereValutazione(toSedeScope(OWNER_ALL), 'c1')).toEqual({ agenziaId: 'c1' });
  });

  it('senza sedi accessibili: fail-closed, nessuna riga', () => {
    expect(whereValutazione(toSedeScope(SENZA_SEDI), 'c1')).toEqual({
      agenziaId: 'c1',
      agenziaSedeId: { in: [] },
    });
  });
});

describe('wherePraticaAttiva', () => {
  it('agenzia membro: filtra su agenziaSedeId', () => {
    expect(wherePraticaAttiva(toSedeScope(MEMBRO), { companyId: 'c1', ruolo: 'AGENZIA' })).toEqual({
      agenziaAssegnataId: 'c1',
      agenziaSedeId: { in: ['s2'] },
      deletedAt: null,
    });
  });

  it('broker membro: filtra su brokerSedeId', () => {
    expect(wherePraticaAttiva(toSedeScope(MEMBRO), { companyId: 'c1', ruolo: 'DEALER' })).toEqual({
      brokerId: 'c1',
      brokerSedeId: { in: ['s2'] },
      deletedAt: null,
    });
  });

  it('owner aggregato: nessun filtro sede', () => {
    expect(wherePraticaAttiva(toSedeScope(OWNER_ALL), { companyId: 'c1', ruolo: 'AGENZIA' })).toEqual({
      agenziaAssegnataId: 'c1',
      deletedAt: null,
    });
  });

  it('owner aggregato broker: nessun filtro sede', () => {
    expect(wherePraticaAttiva(toSedeScope(OWNER_ALL), { companyId: 'c1', ruolo: 'DEALER' })).toEqual({
      brokerId: 'c1',
      deletedAt: null,
    });
  });

  it('senza sedi accessibili: fail-closed, nessuna riga', () => {
    expect(wherePraticaAttiva(toSedeScope(SENZA_SEDI), { companyId: 'c1', ruolo: 'AGENZIA' })).toEqual({
      agenziaAssegnataId: 'c1',
      deletedAt: null,
      agenziaSedeId: { in: [] },
    });
  });
});

describe('whereAssegnazionePending', () => {
  it('membro: solo assegnazioni indirizzate alle sue sedi', () => {
    expect(whereAssegnazionePending(toSedeScope(MEMBRO), 'c1')).toEqual({
      agenziaId: 'c1',
      esito: 'PENDING',
      sedeId: { in: ['s2'] },
    });
  });

  it('owner aggregato: nessun filtro sede', () => {
    expect(whereAssegnazionePending(toSedeScope(OWNER_ALL), 'c1')).toEqual({
      agenziaId: 'c1',
      esito: 'PENDING',
    });
  });

  it('senza sedi accessibili: fail-closed, nessuna riga', () => {
    expect(whereAssegnazionePending(toSedeScope(SENZA_SEDI), 'c1')).toEqual({
      agenziaId: 'c1',
      esito: 'PENDING',
      sedeId: { in: [] },
    });
  });
});

describe('whereDocumentoFiscale', () => {
  it('owner aggregato: tutti i documenti della madre', () => {
    expect(whereDocumentoFiscale(toSedeScope(OWNER_ALL), { companyId: 'c1', ruolo: 'AGENZIA' })).toEqual(
      { destinatarioCompanyId: 'c1' },
    );
  });

  it('agenzia membro: fattura della sua pratica oppure payout del suo wallet', () => {
    expect(whereDocumentoFiscale(toSedeScope(MEMBRO), { companyId: 'c1', ruolo: 'AGENZIA' })).toEqual({
      AND: [
        { destinatarioCompanyId: 'c1' },
        {
          OR: [
            { pratica: { agenziaSedeId: { in: ['s2'] } } },
            { payout: { wallet: { sedeId: { in: ['s2'] } } } },
          ],
        },
      ],
    });
  });

  it('broker membro: si aggancia a brokerSedeId', () => {
    expect(whereDocumentoFiscale(toSedeScope(MEMBRO), { companyId: 'c1', ruolo: 'DEALER' })).toEqual({
      AND: [
        { emittenteCompanyId: 'c1' },
        {
          OR: [
            { pratica: { brokerSedeId: { in: ['s2'] } } },
            { payout: { wallet: { sedeId: { in: ['s2'] } } } },
          ],
        },
      ],
    });
  });

  it('senza sedi accessibili: fail-closed su entrambi gli agganci', () => {
    expect(whereDocumentoFiscale(toSedeScope(SENZA_SEDI), { companyId: 'c1', ruolo: 'AGENZIA' })).toEqual({
      AND: [
        { destinatarioCompanyId: 'c1' },
        {
          OR: [
            { pratica: { agenziaSedeId: { in: [] } } },
            { payout: { wallet: { sedeId: { in: [] } } } },
          ],
        },
      ],
    });
  });
});
