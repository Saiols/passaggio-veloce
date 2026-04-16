'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';

const AUTO_ADDEBITO_DAYS = 20;

export async function markFirmaAvvenutaAction(praticaId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.companyType !== 'AGENZIA') {
    redirect('/dashboard');
  }
  const agenziaId = session.user.companyId!;

  try {
    await prisma.$transaction(async (tx) => {
      const pratica = await tx.pratica.findUnique({ where: { id: praticaId } });
      if (!pratica) throw new Error('Pratica non trovata');
      if (pratica.agenziaAssegnataId !== agenziaId) {
        throw new Error('Pratica non assegnata a questa agenzia');
      }
      if (pratica.stato !== 'ACCETTATA') {
        throw new Error('Pratica non nello stato ACCETTATA');
      }

      const now = new Date();
      const autoAddebitoAt = new Date(now.getTime() + AUTO_ADDEBITO_DAYS * 86_400_000);

      await tx.pratica.update({
        where: { id: praticaId },
        data: {
          stato: 'FIRMATA',
          firmaAvvenutaAt: now,
          autoAddebitoAt,
        },
      });

      // Credito wallet broker
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
      if (pratica.feeAgenziaCent > 0) {
        await tx.feeAddebito.create({
          data: {
            praticaId: pratica.id,
            agenziaId,
            importoCent: pratica.feeAgenziaCent,
            tipo: 'ADDEBITO_FIRMA',
            stato: 'SCHEDULED',
            scheduledAt: now,
          },
        });
      }
    });
  } catch (err) {
    redirect(`/pratiche/${praticaId}?error=${encodeURIComponent((err as Error).message)}`);
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
