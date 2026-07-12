import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { getSessionContext, getManageableSedi } from '@/lib/auth/session-context';
import { can, assignablePermessi, type PermessiCtx } from '@/lib/auth/permessi/check';
import { assertPermesso } from '@/lib/auth/permessi/guard';
import { isPermesso } from '@/lib/auth/permessi/catalogo';
import { riconoscePreset, PRESET_ETICHETTE } from '@/lib/auth/permessi/preset';
import { etichettaRuolo } from '@/lib/auth/permessi/ruoli';
import type { SedeRuolo } from '@/lib/sedi/scope';
import { RevokeButton } from './revoke-button';
import { DisableTeamUserButton } from './disable-button';
import { TeamPageClient } from './team-page-client';
import { formatRelative } from '@/lib/format';

export default async function TeamPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const ctx = await getSessionContext();
  if (!ctx?.companyId) redirect('/dashboard');
  if (!ctx.companyType) redirect('/dashboard'); // azienda senza tipo: il catalogo non si applica
  // Autenticazione → permesso → scope. Senza `team.view` la voce sparisce dalla sidebar:
  // se la pagina non facesse anche il redirect, basterebbe digitare l'URL per entrare.
  await assertPermesso('team.view');
  const manageable = await getManageableSedi();
  if (manageable.length === 0) redirect('/dashboard'); // né owner né admin di sede
  const companyId = ctx.companyId;
  const companyType = ctx.companyType;
  const manageableIds = manageable.map((s) => s.id);
  const permessiCtx: PermessiCtx = { userId: ctx.user.id, isOwner: ctx.isOwner, permessi: ctx.permessi };
  const assegnabili = assignablePermessi(permessiCtx, companyType);
  const puoScegliere = can(permessiCtx, 'team.permessi');

  // Owner: vede tutti gli utenti della madre. Admin di sede: solo gli utenti
  // con membership nelle sedi che amministra.
  const usersWhere = ctx.isOwner
    ? { companyId, deletedAt: null }
    : {
        companyId,
        deletedAt: null,
        sediMembership: { some: { sedeId: { in: manageableIds } } },
      };
  const invitationsWhere = ctx.isOwner
    ? { companyId, status: 'PENDING' as const }
    : { companyId, status: 'PENDING' as const, sedeId: { in: manageableIds } };

  const [users, invitations] = await Promise.all([
    prisma.user.findMany({
      where: usersWhere,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, email: true, nome: true, cognome: true,
        role: true, status: true, lastLoginAt: true, permessi: true,
        // Ristretta a manageableIds: un admin di sede non deve vedere le
        // membership dell'utente in sedi che non amministra (stesso confine
        // già applicato a usersWhere sopra).
        sediMembership: {
          where: { sedeId: { in: manageableIds } },
          select: { sedeId: true, ruolo: true },
        },
      },
    }),
    prisma.invitation.findMany({
      where: invitationsWhere,
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, createdAt: true, expiresAt: true },
    }),
  ]);
  const sedi = manageable.map((s) => ({ id: s.id, nome: s.nome }));
  const sedeNomeById = new Map(manageable.map((s) => [s.id, s.nome]));

  /**
   * Badge permessi: nome del preset se il set coincide esattamente, altrimenti
   * `Personalizzato · N`. Il proprietario (ADMIN_AZIENDA) ha tutti i poteri per
   * ruolo implicito e non ha un set di permessi significativo in DB: nessun
   * badge per lui.
   */
  function permessiBadge(u: { role: string; permessi: string[] }): string | null {
    if (u.role === 'ADMIN_AZIENDA') return null;
    const puliti = u.permessi.filter(isPermesso);
    const presetId = riconoscePreset(puliti, companyType);
    return presetId ? PRESET_ETICHETTE[presetId] : `Personalizzato · ${puliti.length} permessi`;
  }

  /**
   * Etichetta di ruolo per la riga utente: STESSA fonte (`etichettaRuolo`)
   * usata dalla card sidebar, non un "Admin"/"Utente" locale. Un non-owner non
   * ha un ruolo unico: dipende dalla sede (admin in una, operatore in
   * un'altra). Se tutte le sue membership visibili producono la stessa
   * etichetta ne basta una; se divergono, il dettaglio per sede — un'etichetta
   * sola ne nasconderebbe una vera.
   */
  function ruoloRigaTeam(u: {
    role: string;
    sediMembership: { sedeId: string; ruolo: string }[];
  }): string {
    if (u.role === 'ADMIN_AZIENDA') {
      return etichettaRuolo({ role: u.role, sedeRole: 'OWNER' });
    }
    if (u.sediMembership.length === 0) {
      return etichettaRuolo({ role: u.role, sedeRole: null });
    }
    const perSede = u.sediMembership.map((m) => ({
      sedeId: m.sedeId,
      label: etichettaRuolo({ role: u.role, sedeRole: m.ruolo as SedeRuolo }),
    }));
    const distinte = new Set(perSede.map((s) => s.label));
    if (distinte.size === 1) return perSede[0]!.label;
    return perSede
      .map((s) => `${s.label} a ${sedeNomeById.get(s.sedeId) ?? '—'}`)
      .join(' · ');
  }

  return (
    <AppShell session={session} activePath="/team">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-6 sm:py-10">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-pv-slate-500">
              Azienda
            </p>
            <h1 className="mt-1 text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">
              Team
            </h1>
            <p className="mt-1 text-[13px] text-pv-slate-500">
              Gestisci gli utenti che possono operare per conto della tua azienda.
            </p>
          </div>
          <TeamPageClient
            sedi={sedi}
            companyType={companyType}
            assegnabili={assegnabili}
            puoScegliere={puoScegliere}
          />
        </header>

        <section className="rounded-2xl border border-pv-slate-200 bg-white p-6 mb-6">
          <h2 className="text-base font-bold text-pv-navy-900">
            Utenti attivi ({users.length})
          </h2>
          <ul className="mt-3 divide-y divide-pv-slate-100">
            {users.map((u) => {
              const badge = permessiBadge(u);
              return (
              <li
                key={u.id}
                className="flex items-center justify-between gap-3 py-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-pv-navy-900">
                    {u.nome} {u.cognome}
                  </p>
                  <p className="truncate text-xs text-pv-slate-500">
                    {u.email} · {ruoloRigaTeam(u)}
                    {badge && (
                      <>
                        {' · '}
                        <span className="inline-block rounded-full bg-pv-slate-100 px-2 py-0.5 text-[11px] font-medium text-pv-slate-700">
                          {badge}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <span className="text-xs text-pv-slate-500 hidden sm:inline">
                  {u.lastLoginAt
                    ? `Ultimo accesso ${formatRelative(u.lastLoginAt)}`
                    : 'Mai entrato'}
                </span>
                {u.id !== session.user.id && (
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/team/${u.id}/edit`}
                      className="rounded-lg border border-pv-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-pv-navy-700 hover:bg-pv-slate-50"
                    >
                      Modifica
                    </Link>
                    <DisableTeamUserButton
                      userId={u.id}
                      nome={u.nome}
                      cognome={u.cognome}
                    />
                  </div>
                )}
              </li>
              );
            })}
          </ul>
        </section>

        {invitations.length > 0 && (
          <section className="rounded-2xl border border-pv-slate-200 bg-white p-6">
            <h2 className="text-base font-bold text-pv-navy-900">Inviti in attesa</h2>
            <ul className="mt-3 divide-y divide-pv-slate-100">
              {invitations.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <p className="font-semibold text-pv-navy-900">{inv.email}</p>
                    <p className="text-xs text-pv-slate-500">
                      Inviato {formatRelative(inv.createdAt)} · scade {formatRelative(inv.expiresAt)}
                    </p>
                  </div>
                  <RevokeButton invitationId={inv.id} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  );
}
