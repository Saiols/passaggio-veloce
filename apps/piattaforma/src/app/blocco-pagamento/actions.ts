'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@pv/db';
import { auth } from '@/auth';
import { processFeeAddebito } from '@/lib/fee/process';
import { applySepaMandateToAgency } from '@/lib/providers/payment/stripe-mandate';

export type RimedioResult = { ok: true } | { ok: false; error: string };

async function getAgenziaIdLoggata(): Promise<string | null> {
  const session = await auth();
  const u = session?.user;
  if (!u || u.companyType !== 'AGENZIA' || !u.companyId) return null;
  return u.companyId;
}

/** Ri-processa tutti gli addebiti scoperti (FAILED/RETRY) dell'agenzia. */
async function ritentaAddebitiScoperti(agenziaId: string): Promise<void> {
  const scoperti = await prisma.feeAddebito.findMany({
    where: { agenziaId, stato: { in: ['FAILED', 'RETRY'] } },
    select: { id: true },
  });
  for (const f of scoperti) {
    await prisma.feeAddebito.update({
      where: { id: f.id },
      data: { stato: 'SCHEDULED', scheduledAt: new Date(), tentativi: { increment: 1 }, errorMessage: null },
    });
    await processFeeAddebito(f.id);
  }
}

/** Riprova l'addebito col mandato esistente (l'agenzia ha sistemato con la banca). */
export async function ritentaAddebitoAction(): Promise<RimedioResult> {
  const agenziaId = await getAgenziaIdLoggata();
  if (!agenziaId) return { ok: false, error: 'Non autorizzato' };
  await ritentaAddebitiScoperti(agenziaId);
  revalidatePath('/blocco-pagamento');
  return { ok: true };
}

const ibanSchema = z.object({
  iban: z.string().trim().min(15).max(34).transform((s) => s.toUpperCase()),
});

/** Aggiorna l'IBAN, ri-crea il mandato SEPA, poi riprova l'addebito. */
export async function aggiornaIbanERitentaAction(formData: FormData): Promise<RimedioResult> {
  const agenziaId = await getAgenziaIdLoggata();
  if (!agenziaId) return { ok: false, error: 'Non autorizzato' };

  const parsed = ibanSchema.safeParse({ iban: formData.get('iban') });
  if (!parsed.success) return { ok: false, error: 'IBAN non valido' };
  const iban = parsed.data.iban;

  const agenzia = await prisma.company.findUnique({
    where: { id: agenziaId },
    select: { ragioneSociale: true, email: true },
  });
  if (!agenzia) return { ok: false, error: 'Azienda non trovata' };

  await prisma.company.update({ where: { id: agenziaId }, data: { iban } });

  const hdrs = await headers();
  const status = await applySepaMandateToAgency({
    companyId: agenziaId,
    iban,
    name: agenzia.ragioneSociale,
    email: agenzia.email,
    ip: hdrs.get('x-forwarded-for') ?? hdrs.get('x-real-ip'),
    userAgent: hdrs.get('user-agent'),
  });

  if (status === 'FAILED') {
    revalidatePath('/blocco-pagamento');
    return { ok: false, error: "Configurazione del mandato SEPA non riuscita con il nuovo IBAN. Verifica l'IBAN e riprova." };
  }
  if (status === 'PENDING') {
    // Mandato non ancora ACTIVE: l'addebito richiede mandato attivo. Si potrà
    // ritentare appena il mandato è confermato (webhook setup_intent.succeeded).
    revalidatePath('/blocco-pagamento');
    return { ok: true };
  }
  // ACTIVE → riprova subito
  await ritentaAddebitiScoperti(agenziaId);
  revalidatePath('/blocco-pagamento');
  return { ok: true };
}
