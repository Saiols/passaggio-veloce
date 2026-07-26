import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { AppShell } from '@/components/app-shell';
import { Alert } from '@/components/ui';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import {
  getRigaTariffaCorrente,
  getTariffaProgrammata,
  getTariffarioCorrente,
} from '@/lib/tariffario';
import { TariffeClient } from './client';

export default async function AdminTariffePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return (
      <AppShell session={session} activePath="/admin/tariffe">
        <div className="mx-auto max-w-3xl px-5 py-10 sm:px-6">
          <Alert variant="info" title="Sezione riservata">
            Solo gli admin platform possono modificare le tariffe.
          </Alert>
        </div>
      </AppShell>
    );
  }

  const now = new Date();
  const [tariffario, rigaCorrente, programmataRow, storicoRows, aziendeAttive] = await Promise.all([
    getTariffarioCorrente(),
    getRigaTariffaCorrente(now),
    getTariffaProgrammata(now),
    prisma.tariffaPiattaforma.findMany({
      orderBy: [{ efficaceDal: 'desc' }, { createdAt: 'desc' }],
      take: 20,
      include: { createdBy: { select: { nome: true, cognome: true, email: true } } },
    }),
    prisma.company.count({ where: { deletedAt: null, type: { in: ['DEALER', 'AGENZIA'] } } }),
  ]);

  const riaccettazioni = programmataRow
    ? await prisma.riaccettazioneTariffa.count({ where: { tariffaId: programmataRow.id } })
    : 0;

  const iniziale = {
    sempliceFeeEuro: tariffario.SEMPLICE.feeAgenziaCent / 100,
    sempliceCommissioneEuro: tariffario.SEMPLICE.creditoBrokerCent / 100,
    sempliceAffiliazioneEuro: tariffario.SEMPLICE.affiliazioneCent / 100,
    minivolturaFeeEuro: tariffario.MINIVOLTURA.feeAgenziaCent / 100,
    minivolturaCommissioneEuro: tariffario.MINIVOLTURA.creditoBrokerCent / 100,
    minivolturaAffiliazioneEuro: tariffario.MINIVOLTURA.affiliazioneCent / 100,
  };

  const storico = storicoRows.map((s) => ({
    id: s.id,
    createdAt: s.createdAt.toISOString(),
    efficaceDal: s.efficaceDal.toISOString(),
    inVigore: rigaCorrente?.id === s.id,
    programmata: s.annullataAt === null && s.efficaceDal > now,
    annullataAt: s.annullataAt?.toISOString() ?? null,
    richiedeRiaccettazione: s.richiedeRiaccettazione,
    note: s.note,
    autore: s.createdBy
      ? [s.createdBy.nome, s.createdBy.cognome].filter(Boolean).join(' ') || s.createdBy.email
      : null,
    cents: {
      sempliceFeeAgenziaCent: s.sempliceFeeAgenziaCent,
      sempliceCreditoBrokerCent: s.sempliceCreditoBrokerCent,
      sempliceAffiliazioneCent: s.sempliceAffiliazioneCent,
      minivolturaFeeAgenziaCent: s.minivolturaFeeAgenziaCent,
      minivolturaCreditoBrokerCent: s.minivolturaCreditoBrokerCent,
      minivolturaAffiliazioneCent: s.minivolturaAffiliazioneCent,
    },
  }));

  return (
    <AppShell session={session} activePath="/admin/tariffe">
      <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-6 sm:py-10">
        <h1 className="text-[28px] font-extrabold tracking-tight text-pv-navy-900 sm:text-[32px]">Tariffe</h1>
        <p className="mt-2 text-[14px] text-pv-slate-500">
          Costo agenzia, commissione broker e costo affiliazione per tipo pratica. Ai sensi della
          clausola 3 dei Termini, ogni salvataggio <strong>programma</strong> una variazione: la
          nuova versione entra in vigore dopo il preavviso comunicato via email (7 giorni fino al
          20%, 30 giorni e riaccettazione oltre) e vale per le pratiche inviate da quel momento.
        </p>
        <div className="mt-6">
          <TariffeClient
            iniziale={iniziale}
            storico={storico}
            programmata={
              programmataRow
                ? {
                    id: programmataRow.id,
                    efficaceDal: programmataRow.efficaceDal.toISOString(),
                    richiedeRiaccettazione: programmataRow.richiedeRiaccettazione,
                    riaccettazioni,
                    aziendeDaRiaccettare: aziendeAttive,
                  }
                : null
            }
          />
        </div>
      </div>
    </AppShell>
  );
}
