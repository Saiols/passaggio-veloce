'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { sendNotification } from '@/lib/notifiche';
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
  agenziaId: string,
): Promise<AssignResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Solo admin/assistente può assegnare manualmente' };
  }

  try {
    const notificaData: NotificaData = await prisma.$transaction(async (tx) => {
      const pratica = await tx.pratica.findUnique({
        where: { id: praticaId },
        include: {
          broker: { select: { ragioneSociale: true } },
        },
      });
      if (!pratica) throw new Error('Pratica non trovata');
      if (pratica.stato !== 'IN_ESCALATION') {
        throw new Error('La pratica non è in escalation');
      }

      const agenzia = await tx.company.findUnique({
        where: { id: agenziaId },
        select: {
          id: true,
          type: true,
          deletedAt: true,
          ragioneSociale: true,
          email: true,
        },
      });
      if (!agenzia || agenzia.type !== 'AGENZIA') {
        throw new Error('Agenzia non valida');
      }
      if (agenzia.deletedAt !== null) {
        throw new Error("L'agenzia selezionata è stata eliminata");
      }

      await tx.praticaAssegnazione.create({
        data: {
          praticaId,
          agenziaId,
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
          agenziaAssegnataId: agenziaId,
          accettataAt: new Date(),
        },
      });

      return {
        agenziaEmail: agenzia.email,
        agenziaRagioneSociale: agenzia.ragioneSociale,
        codicePratica: pratica.codicePratica,
        targa: pratica.targa,
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
          companyId: agenziaId,
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

    revalidatePath('/admin/escalation');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Errore sconosciuto',
    };
  }
}
