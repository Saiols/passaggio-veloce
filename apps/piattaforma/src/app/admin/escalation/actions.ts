'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { sendNotification } from '@/lib/notifiche';
import { emitEventoPratica } from '@/lib/eventi/emit';
import { eventoPraticaAssegnata } from '@/lib/eventi/pratica-eventi';
import { isAdminOrAssistente } from '@/lib/auth/permissions';

export type AssignResult = { ok: true } | { ok: false; error: string };

type NotificaData = {
  agenziaEmail: string;
  agenziaRagioneSociale: string;
  codicePratica: string | null;
  targa: string | null;
  comune: string | null;
  provincia: string | null;
  feeCent: number;
};

/**
 * Round convenzionale per le assegnazioni manuali da parte dell'admin.
 * Valore alto per non collidere con i round 1/2/3 standard.
 */
const ESCALATION_ROUND = 99;

export async function assegnaEscalationAction(
  praticaId: string,
  sedeId: string,
): Promise<AssignResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Solo admin/assistente può assegnare manualmente' };
  }

  try {
    const notificaData: NotificaData & { agenziaCompanyId: string; agenziaSedeId: string } =
      await prisma.$transaction(async (tx) => {
        const pratica = await tx.pratica.findUnique({
          where: { id: praticaId },
          include: {
            broker: { select: { ragioneSociale: true } },
            veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
          },
        });
        if (!pratica) throw new Error('Pratica non trovata');
        if (pratica.stato !== 'IN_ESCALATION') {
          throw new Error('La pratica non è in escalation');
        }

        // Multi-sede: l'assegnazione manuale è verso una SEDE agenzia.
        const sede = await tx.sede.findUnique({
          where: { id: sedeId },
          select: {
            id: true,
            type: true,
            deletedAt: true,
            suspendedAt: true,
            nome: true,
            email: true,
            companyId: true,
            company: { select: { email: true } },
          },
        });
        if (!sede || sede.type !== 'AGENZIA') {
          throw new Error('Sede agenzia non valida');
        }
        if (sede.deletedAt !== null || sede.suspendedAt !== null) {
          throw new Error('La sede selezionata non è attiva');
        }

        await tx.praticaAssegnazione.create({
          data: {
            praticaId,
            agenziaId: sede.companyId,
            sedeId: sede.id,
            round: ESCALATION_ROUND,
            esito: 'ACCETTATA',
            invioAt: new Date(),
            esitoAt: new Date(),
          },
        });

        await tx.pratica.update({
          where: { id: praticaId },
          data: {
            // "ACCETTATA" è lo stato corretto post-assegnazione manuale
            // (ASSEGNATA non esiste nell'enum PraticaStato)
            stato: 'ACCETTATA',
            agenziaAssegnataId: sede.companyId,
            agenziaSedeId: sede.id,
            accettataAt: new Date(),
          },
        });

        return {
          agenziaCompanyId: sede.companyId,
          agenziaSedeId: sede.id,
          agenziaEmail: sede.email ?? sede.company.email,
          agenziaRagioneSociale: sede.nome,
        codicePratica: pratica.codicePratica,
        targa:
          pratica.veicoli[0]?.targa
            ? pratica.veicoli.length > 1
              ? `${pratica.veicoli[0].targa} +${pratica.veicoli.length - 1}`
              : pratica.veicoli[0].targa
            : null,
        comune: pratica.comune,
        provincia: pratica.provincia,
        feeCent: pratica.feeAgenziaCent,
      };
    });

    // Best-effort notification (fuori transazione)
    try {
      await sendNotification({
        tipo: 'N6_AGENZIA_NUOVA_PRATICA',
        target: {
          email: notificaData.agenziaEmail,
          companyId: notificaData.agenziaCompanyId,
        },
        payload: {
          codicePratica: notificaData.codicePratica ?? '—',
          targa: notificaData.targa,
          comune: notificaData.comune,
          provincia: notificaData.provincia,
          feeCent: notificaData.feeCent,
          round: ESCALATION_ROUND,
          altreAgenzie: 0,
          countdownFineAt: null,
          nomeAgenzia: notificaData.agenziaRagioneSociale,
        },
      });
    } catch {
      // swallow notification errors — assegnazione già avvenuta
    }

    // Evento in-app (modale) per l'agenzia assegnata.
    if (notificaData.codicePratica) {
      try {
        await emitEventoPratica(
          prisma,
          eventoPraticaAssegnata({
            praticaId,
            agenziaId: notificaData.agenziaCompanyId,
            sedeId: notificaData.agenziaSedeId,
            codicePratica: notificaData.codicePratica,
          }),
        );
      } catch {
        // best-effort
      }
    }

    revalidatePath('/admin/escalation');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Errore sconosciuto',
    };
  }
}
