/**
 * Backfill one-shot dei permessi granulari. Va eseguito PRIMA del deploy del
 * codice con i gate attivi, altrimenti ogni operatore resta senza poteri per la
 * durata del rilascio.
 *
 *   pnpm --filter piattaforma exec tsx scripts/backfill-permessi.ts --dry-run
 *   pnpm --filter piattaforma exec tsx scripts/backfill-permessi.ts
 */
import { prisma } from '@pv/db';
import { permessiBackfill, decidiMembership } from '../src/lib/auth/permessi/backfill';
import type { CompanyTypeP } from '../src/lib/auth/permessi/catalogo';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const utenti = await prisma.user.findMany({
    where: { companyId: { not: null } },
    select: {
      id: true,
      email: true,
      role: true,
      company: { select: { type: true } },
      sediMembership: { select: { ruolo: true }, orderBy: { sedeId: 'asc' } },
    },
  });

  let owner = 0;
  let aggiornati = 0;
  let saltati = 0;

  for (const u of utenti) {
    if (u.role === 'ADMIN_AZIENDA') {
      owner++;
      continue; // pieni poteri impliciti: il campo non viene mai letto
    }
    const tipo = u.company?.type as CompanyTypeP | undefined;
    if (!tipo) {
      console.warn(`SALTATO ${u.email}: azienda senza type`);
      saltati++;
      continue;
    }
    const decisione = decidiMembership(u.sediMembership);
    if (decisione.azione === 'salta') {
      const messaggio = decisione.motivo.includes('membership di sede (atteso')
        ? `${decisione.motivo} — risolvere a mano prima del deploy dei gate`
        : decisione.motivo;
      console.warn(`SALTATO ${u.email}: ${messaggio}`);
      saltati++;
      continue;
    }
    const membership = u.sediMembership[0];
    const permessi = permessiBackfill(tipo, decisione.ruolo);
    console.log(`${u.email} [${tipo}/${membership.ruolo}] → ${permessi.length} permessi`);
    if (!dryRun) {
      await prisma.user.update({ where: { id: u.id }, data: { permessi } });
    }
    aggiornati++;
  }

  console.log(
    `\n${dryRun ? '[DRY RUN] ' : ''}owner ignorati: ${owner} · aggiornati: ${aggiornati} · saltati: ${saltati}`,
  );

  if (saltati > 0) {
    console.error(
      '\n' +
        '═'.repeat(80) +
        '\n' +
        '⚠️  ATTENZIONE: Alcuni utenti sono stati saltati.\n' +
        `\nQuesti ${saltati} utenti avranno permessi = [] dopo il deploy dei gate\n` +
        'e nessun accesso alla piattaforma. Risolvere prima di procedere.\n' +
        '═'.repeat(80),
    );
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
