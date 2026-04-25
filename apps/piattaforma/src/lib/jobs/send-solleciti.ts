import 'server-only';
import { prisma } from '@pv/db';
import { env } from '@/env';
import { sendNotification } from '@/lib/notifiche';

/** In DEMO i solleciti scattano dopo 5 minuti dall'accettazione; in produzione dopo 5 giorni. */
const SOGLIA_DEMO_MS = 5 * 60_000;
const SOGLIA_PROD_MS = 5 * 86_400_000;

export type SollecitiResult = {
  n3Sent: number;
  n7Sent: number;
};

export async function sendSolleciti(): Promise<SollecitiResult> {
  const soglia = env.DEMO_MODE ? SOGLIA_DEMO_MS : SOGLIA_PROD_MS;
  const cutoff = new Date(Date.now() - soglia);

  const pratiche = await prisma.pratica.findMany({
    where: {
      stato: 'ACCETTATA',
      accettataAt: { lte: cutoff },
    },
    select: {
      id: true,
      codicePratica: true,
      targa: true,
      feeAgenziaCent: true,
      accettataAt: true,
      broker: {
        select: {
          id: true,
          email: true,
          ragioneSociale: true,
          users: {
            where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
            select: { id: true, email: true, nome: true },
            take: 1,
          },
        },
      },
      agenziaAssegnata: {
        select: {
          id: true,
          email: true,
          ragioneSociale: true,
          users: {
            where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
            select: { id: true, email: true, nome: true },
            take: 1,
          },
        },
      },
    },
  });

  let n3Sent = 0;
  let n7Sent = 0;

  for (const p of pratiche) {
    const codice = p.codicePratica ?? p.id;
    const now = Date.now();
    const accettataMs = p.accettataAt ? p.accettataAt.getTime() : now;
    const giorniTrascorsi = Math.floor((now - accettataMs) / 86_400_000);

    // N3 — sollecito al broker (dealer) affinché solleciti l'agenzia a firmare
    try {
      const brokerUser = p.broker.users[0];
      const brokerEmail = brokerUser?.email ?? p.broker.email;
      const nomeBroker = brokerUser?.nome ?? p.broker.ragioneSociale;
      const agenziaNome = p.agenziaAssegnata?.ragioneSociale ?? 'agenzia assegnata';

      await sendNotification({
        tipo: 'N3_BROKER_SOLLECITO',
        target: {
          email: brokerEmail,
          userId: brokerUser?.id ?? null,
          companyId: p.broker.id,
        },
        payload: {
          codicePratica: codice,
          targa: p.targa,
          agenziaNome,
          nomeBroker,
          giorniTrascorsi,
        },
      });
      n3Sent++;
    } catch {
      /* errori swallowed — già tracciati in NotificaInviata (stato=FAILED) */
    }

    // N7 — promemoria countdown all'agenzia assegnata
    if (p.agenziaAssegnata) {
      try {
        const agenziaUser = p.agenziaAssegnata.users[0];
        const agenziaEmail = agenziaUser?.email ?? p.agenziaAssegnata.email;
        const nomeAgenzia = p.agenziaAssegnata.ragioneSociale;

        // Data entro cui si attende la firma: soglia + accettataAt
        const firmaEntroAt = new Date(accettataMs + soglia * 4); // ~20gg in prod, ~20min in demo

        await sendNotification({
          tipo: 'N7_AGENZIA_PROMEMORIA_COUNTDOWN',
          target: {
            email: agenziaEmail,
            userId: agenziaUser?.id ?? null,
            companyId: p.agenziaAssegnata.id,
          },
          payload: {
            codicePratica: codice,
            targa: p.targa,
            nomeAgenzia,
            feeCent: p.feeAgenziaCent,
            firmaEntroAt,
          },
        });
        n7Sent++;
      } catch {
        /* errori swallowed */
      }
    }
  }

  return { n3Sent, n7Sent };
}
