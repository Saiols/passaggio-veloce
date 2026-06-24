import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Verifica le invarianti dati del refactor multi-sede (Fase 1).
 * Exit code 1 su violazione. Eseguibile sia dopo migrate (backfill SQL) sia
 * dopo seed (backfill TS): entrambi devono produrre lo stesso stato.
 */
async function main() {
  const errors: string[] = [];

  const companies = await prisma.company.count();
  const sedi = await prisma.sede.count();
  if (sedi < companies) errors.push(`sedi (${sedi}) < companies (${companies}): qualche company senza sede`);

  const companiesNoSede = await prisma.company.findMany({
    where: { sedi: { none: {} } },
    select: { id: true, ragioneSociale: true },
  });
  if (companiesNoSede.length) {
    errors.push(`Company senza sede: ${companiesNoSede.map((c) => c.ragioneSociale).join(', ')}`);
  }

  const praticheNoBrokerSede = await prisma.pratica.count({ where: { brokerSedeId: null } });
  if (praticheNoBrokerSede) errors.push(`${praticheNoBrokerSede} pratiche senza brokerSedeId`);

  const praticheAgenziaMismatch = await prisma.pratica.count({
    where: { agenziaAssegnataId: { not: null }, agenziaSedeId: null },
  });
  if (praticheAgenziaMismatch) {
    errors.push(`${praticheAgenziaMismatch} pratiche con agenziaAssegnata ma senza agenziaSedeId`);
  }

  const walletOrfani = await prisma.wallet.count({ where: { sedeId: null, companyId: null } });
  if (walletOrfani) errors.push(`${walletOrfani} wallet orfani (né sede né company)`);

  // I proprietari (ADMIN_AZIENDA) hanno accesso implicito a tutte le sedi della
  // madre: NON richiedono righe UserSede. Il requisito vale per gli altri utenti.
  const opUsers = await prisma.user.count({
    where: { companyId: { not: null }, role: { not: 'ADMIN_AZIENDA' }, deletedAt: null },
  });
  const opUsersWithMembership = await prisma.user.count({
    where: {
      companyId: { not: null },
      role: { not: 'ADMIN_AZIENDA' },
      deletedAt: null,
      sediMembership: { some: {} },
    },
  });
  if (opUsersWithMembership < opUsers) {
    errors.push(
      `UserSede mancanti: ${opUsers - opUsersWithMembership} utenti operativi (non-owner) con companyId senza membership`,
    );
  }

  if (errors.length) {
    console.error('❌ Invarianti multi-sede VIOLATE:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log('✅ Invarianti multi-sede OK', { companies, sedi });
}

main().finally(() => prisma.$disconnect());
