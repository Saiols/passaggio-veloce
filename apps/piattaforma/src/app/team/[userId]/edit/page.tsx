import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { getSessionContext, getManageableSedi } from '@/lib/auth/session-context';
import { can, assignablePermessi, type PermessiCtx } from '@/lib/auth/permessi/check';
import { assertPermesso } from '@/lib/auth/permessi/guard';
import { isPermesso } from '@/lib/auth/permessi/catalogo';
import { etichettaRuolo } from '@/lib/auth/permessi/ruoli';
import { etichetteSediUniche } from '@/lib/sedi/etichetta-sede';
import type { SedeRuolo } from '@/lib/sedi/scope';
import { Card } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import { TeamEditForm } from './edit-form';
import { ResetPasswordSection } from './reset-password';

export default async function TeamUserEditPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const ctx = await getSessionContext();
  if (!ctx?.companyId) redirect('/dashboard');
  if (!ctx.companyType) redirect('/dashboard'); // azienda senza tipo: il catalogo non si applica
  // Autenticazione → permesso → scope, come in /team.
  await assertPermesso('team.view');
  const manageable = await getManageableSedi();
  if (manageable.length === 0) redirect('/dashboard');
  const companyId = ctx.companyId;
  const companyType = ctx.companyType;
  const manageableIds = manageable.map((s) => s.id);
  const permessiCtx: PermessiCtx = { userId: ctx.user.id, isOwner: ctx.isOwner, permessi: ctx.permessi };
  const assegnabili = assignablePermessi(permessiCtx, companyType);
  const puoScegliere = can(permessiCtx, 'team.permessi');

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, nome: true, cognome: true,
      role: true, status: true, companyId: true, lastLoginAt: true, createdAt: true,
      permessi: true,
    },
  });
  if (!target || target.companyId !== companyId) notFound();

  const isOwnerTarget = target.role === 'ADMIN_AZIENDA';
  const membership = await prisma.userSede.findFirst({
    where: { userId, sedeId: { in: manageableIds } },
    select: { sedeId: true, ruolo: true },
  });
  // Un ADMIN_SEDE può modificare solo utenti di una sede che amministra; mai il proprietario.
  if (!ctx.isOwner) {
    if (isOwnerTarget) notFound();
    if (!membership || !manageableIds.includes(membership.sedeId)) notFound();
  }
  // Stessa fonte della sidebar (`etichettaRuolo`): questa pagina già riduce
  // l'utente a UNA sede/ruolo (il form di modifica ne gestisce una sola), quindi
  // qui non può nascere la contraddizione "ruoli diversi per sede" del team.
  const ruoloLabel = etichettaRuolo({
    role: target.role,
    sedeRole: isOwnerTarget ? 'OWNER' : ((membership?.ruolo as SedeRuolo | undefined) ?? null),
  });
  // Selettore sede: le OPZIONI seguono la regola di sempre — il proprietario
  // vede tutte le sedi dell'azienda (= ctx.accessibleSedi per l'owner, niente
  // query ad-hoc: resolveAccessibleSedi() gli dà già tutte le sedi della
  // madre), l'admin di sede solo quelle che amministra (`manageable`). Le
  // ETICHETTE invece si calcolano SEMPRE sull'intero universo
  // `ctx.accessibleSedi`, la stessa fonte di /team e della sidebar: altrimenti
  // la stessa sede avrebbe un nome diverso in due schermate (es. "Admin di
  // sede a Buccinasco" nella riga /team, "Dimensione Auto Milano Srls" nel
  // dropdown qui).
  const labelSedeById = new Map(
    etichetteSediUniche(ctx.accessibleSedi, session.user.companyName).map((s) => [s.id, s.label]),
  );
  const sediOpzioni = ctx.isOwner ? ctx.accessibleSedi : manageable;
  const sedi = sediOpzioni.map((s) => ({ id: s.id, nome: labelSedeById.get(s.id) ?? s.nome }));

  return (
    <AppShell session={session} activePath="/team">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <Link
          href="/team"
          className="mb-5 inline-flex items-center gap-1 text-[13px] font-semibold text-pv-navy-600 hover:underline underline-offset-4"
        >
          ← Torna al team
        </Link>

        <header className="mb-7">
          <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
            Modifica utente team
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
            {target.nome} {target.cognome}
          </h1>
          <p className="mt-1 text-[13px] text-pv-slate-500">
            {target.email} · {ruoloLabel} ·{' '}
            {target.lastLoginAt
              ? `Ultimo accesso ${formatRelative(target.lastLoginAt)}`
              : 'Mai entrato'}
          </p>
        </header>

        <Card className="mb-5">
          <h2 className="text-[15px] font-bold text-pv-navy-800">Dati anagrafici</h2>
          <p className="mt-1 text-[12.5px] text-pv-slate-500">
            {isOwnerTarget
              ? 'Aggiorna nome, cognome ed email. Le modifiche sono immediate.'
              : 'Aggiorna nome, cognome, email, sede di appartenenza e ruolo. Le modifiche sono immediate.'}
          </p>
          <div className="mt-4">
            <TeamEditForm
              userId={target.id}
              defaultEmail={target.email}
              defaultNome={target.nome}
              defaultCognome={target.cognome}
              isOwner={isOwnerTarget}
              sedi={sedi}
              defaultSedeId={membership?.sedeId ?? ''}
              defaultRuolo={membership?.ruolo ?? 'OPERATORE'}
              companyType={companyType}
              assegnabili={assegnabili}
              puoScegliere={puoScegliere}
              permessiIniziali={target.permessi.filter(isPermesso)}
              currentUserId={ctx.user.id}
            />
          </div>
        </Card>

        <Card>
          <h2 className="text-[15px] font-bold text-pv-navy-800">Reset password</h2>
          <p className="mt-1 text-[12.5px] text-pv-slate-500">
            Genera una nuova password per questo utente. Per motivi di sicurezza
            (e GDPR) la password viene mostrata <strong>una sola volta</strong>:
            copiala e comunicala al dipendente fuori piattaforma. Non e&apos;
            recuperabile in seguito.
          </p>
          <ResetPasswordSection userId={target.id} />
        </Card>
      </div>
    </AppShell>
  );
}
