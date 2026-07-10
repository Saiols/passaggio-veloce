/**
 * Backfill one-shot dei permessi granulari. Va eseguito PRIMA del deploy del
 * codice con i gate attivi, altrimenti ogni operatore resta senza poteri per la
 * durata del rilascio.
 *
 * Copre due tabelle:
 *  - `User` esistenti (companyId non nullo);
 *  - `Invitation` PENDING non scadute create PRIMA di questo backfill, cioè
 *    con `permessi = []` (default dello schema). Un invito PENDING al momento
 *    della migration veniva copiato fedelmente da `acceptInvitationAction`:
 *    senza questo passo, chi lo accetta nasce con zero permessi — fail-safe
 *    (sotto-privilegio, non escalation), ma è qualcuno che il lunedì mattina
 *    non riesce a lavorare, e nessuno capisce perché. Un invito con
 *    `permessi` già valorizzati (creato dal codice nuovo, dopo il deploy di
 *    `createInvitationAction` con `permessiPerNuovoUtente`) NON viene toccato:
 *    il filtro `permessi: { isEmpty: true }` lo esclude a livello di query.
 *
 *   pnpm --filter piattaforma exec tsx scripts/backfill-permessi.ts --dry-run
 *   pnpm --filter piattaforma exec tsx scripts/backfill-permessi.ts
 */
import { prisma } from '@pv/db';
import { permessiBackfill, decidiMembership, decidiInvito } from '../src/lib/auth/permessi/backfill';
import type { CompanyTypeP } from '../src/lib/auth/permessi/catalogo';

const dryRun = process.argv.includes('--dry-run');

async function backfillUtenti(): Promise<{ owner: number; aggiornati: number; saltati: number }> {
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
      console.warn(`SALTATO utente ${u.email}: azienda senza type`);
      saltati++;
      continue;
    }
    const decisione = decidiMembership(u.sediMembership);
    if (decisione.azione === 'salta') {
      const messaggio = decisione.motivo.includes('membership di sede (atteso')
        ? `${decisione.motivo} — risolvere a mano prima del deploy dei gate`
        : decisione.motivo;
      console.warn(`SALTATO utente ${u.email}: ${messaggio}`);
      saltati++;
      continue;
    }
    const membership = u.sediMembership[0];
    const permessi = permessiBackfill(tipo, decisione.ruolo);
    console.log(`UTENTE  ${u.email} [${tipo}/${membership.ruolo}] → ${permessi.length} permessi`);
    if (!dryRun) {
      await prisma.user.update({ where: { id: u.id }, data: { permessi } });
    }
    aggiornati++;
  }

  return { owner, aggiornati, saltati };
}

async function backfillInviti(): Promise<{ aggiornati: number; saltati: number }> {
  const inviti = await prisma.invitation.findMany({
    where: {
      status: 'PENDING',
      expiresAt: { gt: new Date() },
      permessi: { isEmpty: true }, // non tocca un invito già valorizzato dal codice nuovo
    },
    select: {
      id: true,
      email: true,
      sedeId: true,
      ruoloSede: true,
      company: { select: { type: true } },
    },
  });

  let aggiornati = 0;
  let saltati = 0;

  for (const inv of inviti) {
    const tipo = inv.company?.type as CompanyTypeP | undefined;
    if (!tipo) {
      console.warn(`SALTATO invito ${inv.email}: azienda senza type`);
      saltati++;
      continue;
    }
    const decisione = decidiInvito({ sedeId: inv.sedeId, ruoloSede: inv.ruoloSede });
    if (decisione.azione === 'salta') {
      console.warn(`SALTATO invito ${inv.email}: ${decisione.motivo} — risolvere a mano prima del deploy dei gate`);
      saltati++;
      continue;
    }
    const permessi = permessiBackfill(tipo, decisione.ruolo);
    console.log(`INVITO  ${inv.email} [${tipo}/${decisione.ruolo}] → ${permessi.length} permessi`);
    if (!dryRun) {
      await prisma.invitation.update({ where: { id: inv.id }, data: { permessi } });
    }
    aggiornati++;
  }

  return { aggiornati, saltati };
}

async function main() {
  const risultatoUtenti = await backfillUtenti();
  const risultatoInviti = await backfillInviti();

  const saltati = risultatoUtenti.saltati + risultatoInviti.saltati;

  console.log(
    `\n${dryRun ? '[DRY RUN] ' : ''}UTENTI  — owner ignorati: ${risultatoUtenti.owner} · aggiornati: ${risultatoUtenti.aggiornati} · saltati: ${risultatoUtenti.saltati}` +
      `\n${dryRun ? '[DRY RUN] ' : ''}INVITI  — aggiornati: ${risultatoInviti.aggiornati} · saltati: ${risultatoInviti.saltati}`,
  );

  if (saltati > 0) {
    console.error(
      '\n' +
        '═'.repeat(80) +
        '\n' +
        '⚠️  ATTENZIONE: Alcuni utenti e/o inviti sono stati saltati.\n' +
        `\nQuesti ${saltati} record avranno permessi = [] dopo il deploy dei gate\n` +
        '(un utente senza accesso, o un invitato che accetta e nasce senza poteri).\n' +
        'Risolvere prima di procedere.\n' +
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
