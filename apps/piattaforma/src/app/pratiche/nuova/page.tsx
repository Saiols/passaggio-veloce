import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { getSessionContext } from '@/lib/auth/session-context';
import { assertPermesso } from '@/lib/auth/permessi/guard';
import { resolveOperatingSede } from '@/lib/sedi/scope';
import { WizardNuovaPratica } from './wizard';

// Vercel function timeout: 60s su Hobby plan (max), 300s su Pro.
// L'OCR Mindee V2 (enqueueAndGetResult) fa polling async che può superare
// i default 10s, quindi richiediamo esplicitamente il massimo.
export const maxDuration = 60;

export default async function NuovaPraticaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // Autenticazione → permesso → scope.
  await assertPermesso('pratiche.create');

  if (session.user.companyType !== 'DEALER') redirect('/dashboard');

  const sp = await searchParams;

  // Allowlist ATECO per i commercianti auto (DEALER): serve al gate sull'acquirente
  // operatore auto della minivoltura. Gestita da admin in /admin/ateco.
  const atecoAllowed = await prisma.atecoAllowedCode.findMany({
    where: { companyType: 'DEALER', active: true },
    select: { companyType: true, code: true, active: true },
  });

  // Multi-sede: sedi del dealer per il selettore "Sede di partenza" nel wizard
  // (mostrato solo con più di una sede). Default = sede operativa corrente se
  // c'è (utente scoped a una sede); in vista "Tutte le sedi" resta vuoto, così
  // il proprietario sceglie consapevolmente (niente attribuzione silenziosa).
  const ctx = await getSessionContext();
  const sedi = ctx?.accessibleSedi ?? [];
  const defaultSedeId = ctx
    ? resolveOperatingSede({ currentSede: ctx.currentSede, accessibleSedi: ctx.accessibleSedi })?.id
    : undefined;

  return (
    <AppShell session={session} activePath="/pratiche">
      <WizardNuovaPratica
        error={sp.error}
        atecoAllowed={atecoAllowed}
        sedi={sedi}
        defaultSedeId={defaultSedeId}
        userId={session.user.id!}
      />
    </AppShell>
  );
}
