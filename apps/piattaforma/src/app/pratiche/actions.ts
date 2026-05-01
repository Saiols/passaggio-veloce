'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { sendNotification } from '@/lib/notifiche';
import { accreditCommissioniAffiliazione } from '@/lib/affiliazione/accredit';
import { env } from '@/env';

const AUTO_ADDEBITO_DAYS = 20;
const AUTO_ADDEBITO_DEMO_MINUTES = 5;

function computeAutoAddebitoAt(now: Date): Date {
  if (env.DEMO_MODE) {
    return new Date(now.getTime() + AUTO_ADDEBITO_DEMO_MINUTES * 60_000);
  }
  return new Date(now.getTime() + AUTO_ADDEBITO_DAYS * 86_400_000);
}

export async function markFirmaAvvenutaAction(praticaId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.companyType !== 'AGENZIA') {
    redirect('/dashboard');
  }
  const agenziaId = session.user.companyId!;

  try {
    await prisma.$transaction(async (tx) => {
      const pratica = await tx.pratica.findUnique({
        where: { id: praticaId },
        include: {
          broker: {
            include: {
              referente: {
                select: { id: true, suspendedAt: true, deletedAt: true },
              },
            },
          },
          agenziaAssegnata: {
            include: {
              referente: {
                select: { id: true, suspendedAt: true, deletedAt: true },
              },
            },
          },
        },
      });
      if (!pratica) throw new Error('Pratica non trovata');
      if (pratica.agenziaAssegnataId !== agenziaId) {
        throw new Error('Pratica non assegnata a questa agenzia');
      }
      if (pratica.stato !== 'ACCETTATA') {
        throw new Error('Pratica non nello stato ACCETTATA');
      }

      const now = new Date();
      const autoAddebitoAt = computeAutoAddebitoAt(now);

      await tx.pratica.update({
        where: { id: praticaId },
        data: {
          stato: 'FIRMATA',
          firmaAvvenutaAt: now,
          autoAddebitoAt,
        },
      });

      // Credito wallet broker (proventi pratica)
      if (pratica.creditoBrokerCent > 0) {
        const wallet = await tx.wallet.upsert({
          where: { companyId: pratica.brokerId },
          update: {},
          create: { companyId: pratica.brokerId, saldoCent: 0 },
        });
        const nuovoSaldo = wallet.saldoCent + pratica.creditoBrokerCent;
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { saldoCent: nuovoSaldo },
        });
        await tx.transazioneWallet.create({
          data: {
            walletId: wallet.id,
            tipo: 'CREDITO_PRATICA',
            importoCent: pratica.creditoBrokerCent,
            saldoPostCent: nuovoSaldo,
            praticaId: pratica.id,
          },
        });
      }

      // Fee addebito schedulato (Stripe reale in Fase 5)
      // scheduledAt = autoAddebitoAt: il job process-fee-scheduled processa solo
      // FeeAddebito con scheduledAt <= now, rispettando il countdown 5min DEMO / 20gg prod.
      if (pratica.feeAgenziaCent > 0) {
        await tx.feeAddebito.create({
          data: {
            praticaId: pratica.id,
            agenziaId,
            importoCent: pratica.feeAgenziaCent,
            tipo: 'ADDEBITO_FIRMA',
            stato: 'SCHEDULED',
            scheduledAt: autoAddebitoAt,
          },
        });
      }

      // FASE 13: commissioni affiliazione ai referenti di broker e/o agenzia
      // (skip se referente sospeso o eliminato).
      await accreditCommissioniAffiliazione(tx, {
        praticaId: pratica.id,
        tipo: pratica.tipo as 'PASSAGGIO_PRIVATO' | 'MINIVOLTURE_MULTIPLE',
        numeroVeicoli: pratica.numeroVeicoli,
        brokerId: pratica.brokerId,
        agenziaAssegnataId: pratica.agenziaAssegnataId,
        brokerReferente: pratica.broker.referente,
        agenziaReferente: pratica.agenziaAssegnata?.referente ?? null,
      });
    });
  } catch (err) {
    redirect(`/pratiche/${praticaId}?error=${encodeURIComponent((err as Error).message)}`);
  }

  // N4 (broker) + N8 (agenzia): best-effort post-commit
  try {
    const full = await prisma.pratica.findUnique({
      where: { id: praticaId },
      include: {
        broker: {
          include: {
            wallet: true,
            users: {
              where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE' },
              select: { email: true, nome: true, id: true },
              take: 1,
            },
          },
        },
        agenziaAssegnata: {
          include: {
            users: {
              where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE' },
              select: { email: true, id: true },
              take: 1,
            },
          },
        },
      },
    });
    if (full) {
      const brokerUser = full.broker.users[0];
      if (brokerUser) {
        await sendNotification({
          tipo: 'N4_BROKER_FIRMA_E_CREDITO',
          target: {
            email: brokerUser.email,
            userId: brokerUser.id,
            companyId: full.broker.id,
          },
          payload: {
            codicePratica: full.codicePratica ?? '—',
            targa: full.targa,
            agenziaNome: full.agenziaAssegnata?.ragioneSociale ?? '—',
            creditoCent: full.creditoBrokerCent,
            saldoCent: full.broker.wallet?.saldoCent ?? 0,
            nomeBroker: brokerUser.nome,
          },
        }).catch(() => undefined);
      }

      const agenziaUser = full.agenziaAssegnata?.users[0];
      if (full.agenziaAssegnata && agenziaUser && full.autoAddebitoAt) {
        await sendNotification({
          tipo: 'N8_AGENZIA_ADDEBITO',
          target: {
            email: full.agenziaAssegnata.email,
            userId: agenziaUser.id,
            companyId: full.agenziaAssegnata.id,
          },
          payload: {
            codicePratica: full.codicePratica ?? '—',
            feeCent: full.feeAgenziaCent,
            autoAddebitoAt: full.autoAddebitoAt,
            nomeAgenzia: full.agenziaAssegnata.ragioneSociale,
          },
        }).catch(() => undefined);
      }
    }
  } catch {
    // best-effort
  }

  revalidatePath('/dashboard');
  revalidatePath('/pratiche');
  revalidatePath(`/pratiche/${praticaId}`);
  redirect(`/pratiche/${praticaId}?firmata=1`);
}

export async function annullaPraticaAction(praticaId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.companyType !== 'DEALER') {
    redirect('/dashboard');
  }
  const brokerId = session.user.companyId!;

  try {
    await prisma.$transaction(async (tx) => {
      const pratica = await tx.pratica.findUnique({ where: { id: praticaId } });
      if (!pratica) throw new Error('Pratica non trovata');
      if (pratica.brokerId !== brokerId) {
        throw new Error('Non sei il broker di questa pratica');
      }
      if (pratica.stato === 'FIRMATA') {
        throw new Error('Non puoi annullare una pratica già firmata');
      }
      if (pratica.stato === 'ANNULLATA') {
        throw new Error('Pratica già annullata');
      }

      const now = new Date();

      await tx.pratica.update({
        where: { id: praticaId },
        data: {
          stato: 'ANNULLATA',
          annullataAt: now,
        },
      });

      await tx.praticaAssegnazione.updateMany({
        where: { praticaId, esito: 'PENDING' },
        data: { esito: 'ASSEGNATA_ALTRO', esitoAt: now },
      });
    });
  } catch (err) {
    redirect(`/pratiche/${praticaId}?error=${encodeURIComponent((err as Error).message)}`);
  }

  revalidatePath('/dashboard');
  revalidatePath('/pratiche');
  revalidatePath(`/pratiche/${praticaId}`);
  redirect(`/pratiche/${praticaId}?annullata=1`);
}

const valutazioneSchema = z.object({
  praticaId: z.string().uuid(),
  stelle: z.coerce.number().int().min(1).max(5),
  note: z.string().trim().max(500).optional(),
  segnalazioneAbuso: z
    .preprocess((v) => v === 'true' || v === 'on' || v === true, z.boolean())
    .default(false),
});

type ActionResult = { ok: true } | { ok: false; error: string };

export async function submitValutazioneAction(formData: FormData): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };
  if (session.user.companyType !== 'DEALER') {
    return { ok: false, error: 'Solo i broker possono valutare le agenzie' };
  }
  const dealerId = session.user.companyId;
  if (!dealerId) return { ok: false, error: 'Azienda non associata' };

  const parsed = valutazioneSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join('.')}: ${first.message}` : 'Dati non validi',
    };
  }
  const { praticaId, stelle, note, segnalazioneAbuso } = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const pratica = await tx.pratica.findUnique({
        where: { id: praticaId },
        include: { valutazione: true },
      });
      if (!pratica) throw new Error('Pratica non trovata');
      if (pratica.brokerId !== dealerId) throw new Error('Non sei il broker di questa pratica');
      if (pratica.stato !== 'FIRMATA') throw new Error('Puoi valutare solo pratiche firmate');
      if (!pratica.agenziaAssegnataId) throw new Error('Nessuna agenzia assegnata');
      if (pratica.valutazione) throw new Error('Hai già valutato questa pratica');

      await tx.valutazione.create({
        data: {
          praticaId,
          agenziaId: pratica.agenziaAssegnataId,
          dealerId,
          stelle,
          note: note ?? null,
          segnalazioneAbuso,
        },
      });
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath(`/pratiche/${praticaId}`);
  revalidatePath('/dashboard');
  return { ok: true };
}
