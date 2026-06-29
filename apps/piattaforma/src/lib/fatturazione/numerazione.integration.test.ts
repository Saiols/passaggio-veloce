import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@pv/db';
import { prossimoContatore } from './numerazione';

const ID = 'TEST-NUMERAZIONE';
const ANNO = 2999;

// Integration: richiede il Postgres locale (DATABASE_URL). Salta in assenza di DB.
describe.skipIf(!process.env.DATABASE_URL)('prossimoContatore (integration)', () => {
  afterAll(async () => {
    await prisma.contatoreFiscale.deleteMany({ where: { idSoggetto: ID } });
  });

  it('parte da 1 e incrementa', async () => {
    await prisma.contatoreFiscale.deleteMany({ where: { idSoggetto: ID } });
    const a = await prisma.$transaction((tx) => prossimoContatore(tx, ID, 'FATTURA_PV', ANNO));
    const b = await prisma.$transaction((tx) => prossimoContatore(tx, ID, 'FATTURA_PV', ANNO));
    expect([a, b]).toEqual([1, 2]);
  });

  it('sequenze separate per tipo e per anno', async () => {
    await prisma.contatoreFiscale.deleteMany({ where: { idSoggetto: ID } });
    const fatt = await prisma.$transaction((tx) => prossimoContatore(tx, ID, 'FATTURA_PV', ANNO));
    const nota = await prisma.$transaction((tx) => prossimoContatore(tx, ID, 'NOTA_CREDITO', ANNO));
    const annoNuovo = await prisma.$transaction((tx) => prossimoContatore(tx, ID, 'FATTURA_PV', ANNO + 1));
    expect([fatt, nota, annoNuovo]).toEqual([1, 1, 1]); // reset per (tipo, anno)
  });

  it('atomico sotto concorrenza: 1..N contigui, nessun duplicato', async () => {
    await prisma.contatoreFiscale.deleteMany({ where: { idSoggetto: ID } });
    const N = 25;
    const out = await Promise.all(
      Array.from({ length: N }, () =>
        prisma.$transaction((tx) => prossimoContatore(tx, ID, 'DOC_BROKER', ANNO)),
      ),
    );
    expect([...out].sort((x, y) => x - y)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });
});
