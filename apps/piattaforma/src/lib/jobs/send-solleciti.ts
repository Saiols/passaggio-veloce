import 'server-only';
import { prisma } from '@pv/db';
import { env } from '@/env';
import { sendNotification } from '@/lib/notifiche';
import { destinatariAgenzia, destinatariBroker } from '@/lib/notifiche/pratica';

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
      veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
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
    const targaPratica =
      p.veicoli[0]?.targa
        ? p.veicoli.length > 1
          ? `${p.veicoli[0].targa} +${p.veicoli.length - 1}`
          : p.veicoli[0].targa
        : null;
    const now = Date.now();
    const accettataMs = p.accettataAt ? p.accettataAt.getTime() : now;
    const giorniTrascorsi = Math.floor((now - accettataMs) / 86_400_000);

    // N3 — sollecito al broker (dealer) affinché solleciti l'agenzia a firmare
    try {
      // Recapito: chi ha creato la pratica; se non è più raggiungibile la
      // catena scende alla sua sede, poi all'admin azienda. Vedi
      // lib/notifiche/pratica.ts.
      const destinatari = await destinatariBroker(p.id);
      const agenziaNome = p.agenziaAssegnata?.ragioneSociale ?? 'agenzia assegnata';

      for (const d of destinatari) {
        // Un destinatario che fallisce (es. hiccup DB in sendNotification) non
        // deve impedire l'invio agli altri destinatari della stessa pratica.
        await sendNotification({
          tipo: 'N3_BROKER_SOLLECITO',
          target: {
            email: d.email,
            userId: d.userId,
            companyId: p.broker.id,
          },
          payload: {
            codicePratica: codice,
            targa: targaPratica,
            agenziaNome,
            nomeBroker: d.nome,
            giorniTrascorsi,
          },
        }, { praticaId: p.id }).catch(() => undefined);
      }
      // n3Sent conta le pratiche sollecitate, non le email inviate: un solo
      // incremento anche quando la pratica ha più destinatari (sede + admin).
      if (destinatari.length > 0) n3Sent++;
    } catch {
      /* errori swallowed — già tracciati in NotificaInviata (stato=FAILED) */
    }

    // N7 — promemoria countdown all'agenzia assegnata: parte dopo
    // l'accettazione, quindi il destinatario è chi ha accettato (poi la sua
    // sede, poi l'admin azienda). Vedi lib/notifiche/pratica.ts.
    if (p.agenziaAssegnata) {
      try {
        const nomeAgenzia = p.agenziaAssegnata.ragioneSociale;

        // Data entro cui si attende la firma: soglia + accettataAt
        const firmaEntroAt = new Date(accettataMs + soglia * 4); // ~20gg in prod, ~20min in demo

        const destinatari = await destinatariAgenzia(p.id);
        for (const d of destinatari) {
          await sendNotification({
            tipo: 'N7_AGENZIA_PROMEMORIA_COUNTDOWN',
            target: {
              email: d.email,
              userId: d.userId,
              companyId: p.agenziaAssegnata.id,
            },
            payload: {
              codicePratica: codice,
              targa: targaPratica,
              nomeAgenzia,
              feeCent: p.feeAgenziaCent,
              firmaEntroAt,
            },
          }, { praticaId: p.id }).catch(() => undefined);
        }
        // n7Sent conta le pratiche sollecitate, non le email inviate: stesso
        // criterio di n3Sent qui sopra.
        if (destinatari.length > 0) n7Sent++;
      } catch {
        /* errori swallowed */
      }
    }
  }

  return { n3Sent, n7Sent };
}
