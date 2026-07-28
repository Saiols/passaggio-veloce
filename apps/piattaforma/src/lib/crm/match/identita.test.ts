import { describe, it, expect } from 'vitest';
import { identitaDaCompany, type CompanyGrezza } from './identita';

const MADRE: CompanyGrezza = {
  id: 'c1',
  type: 'AGENZIA',
  ragioneSociale: 'AGENZIA CORSICO DI CIAVARELLA ANTONIO',
  partitaIva: '06199680155',
  email: 'Info@AgenziaCorsico.it',
  pec: 'agenziacorsico@pec.it',
  telefono: '024478712',
  indirizzo: 'Via Fiume',
  civico: '6',
  citta: 'Corsico',
  cap: '20094',
  provincia: 'MI',
  createdAt: new Date('2026-01-10T10:00:00Z'),
  sedi: [],
};

describe('identitaDaCompany', () => {
  it('produce una identità per la madre con chiavi normalizzate', () => {
    const [madre, ...resto] = identitaDaCompany(MADRE);
    expect(resto).toHaveLength(0);
    expect(madre).toMatchObject({
      companyId: 'c1',
      sedeId: null,
      cat: 'AGENZIA',
      telKeys: ['024478712'],
      pivaKeys: ['06199680155'],
      indirizzoKey: 'via fiume',
      cittaKey: 'corsico',
      capKey: '20094',
    });
    expect(madre!.emailKeys).toEqual(['info@agenziacorsico.it', 'agenziacorsico@pec.it']);
    expect(madre!.nomeKeys).toEqual(['agenzia corsico di ciavarella antonio']);
  });

  it('mappa DEALER su BROKER', () => {
    const [id] = identitaDaCompany({ ...MADRE, type: 'DEALER' });
    expect(id!.cat).toBe('BROKER');
  });

  it('produce una identità per ogni sede, con la P.IVA della madre', () => {
    const ids = identitaDaCompany({
      ...MADRE,
      sedi: [
        {
          id: 's1',
          type: 'AGENZIA',
          nome: 'Filiale Buccinasco',
          telefono: '+39 02 4408 011',
          email: null,
          indirizzo: 'Via Verdi',
          civico: '5',
          citta: 'Buccinasco',
          cap: '20090',
          provincia: 'MI',
          createdAt: new Date('2026-02-01T10:00:00Z'),
        },
      ],
    });
    expect(ids).toHaveLength(2);
    const sede = ids.find((i) => i.sedeId === 's1')!;
    expect(sede.telKeys).toEqual(['024408011']);
    expect(sede.pivaKeys).toEqual(['06199680155']);
    // Il punto vendita in lista porta l'insegna della madre: entrambi i nomi.
    expect(sede.nomeKeys).toContain('filiale buccinasco');
    expect(sede.nomeKeys).toContain('agenzia corsico di ciavarella antonio');
    expect(sede.registrataAt).toEqual(new Date('2026-02-01T10:00:00Z'));
  });

  it('non produce chiavi vuote', () => {
    const [id] = identitaDaCompany({ ...MADRE, telefono: null, partitaIva: '' });
    expect(id!.telKeys).toEqual([]);
    expect(id!.pivaKeys).toEqual([]);
  });
});
