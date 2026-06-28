'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@pv/db';
import { auth } from '@/auth';
import { ritentaAddebitiAgenzia } from '@/lib/fee/retry';
import { applySepaMandateToAgency } from '@/lib/providers/payment/stripe-mandate';

export type RimedioResult = { ok: true } | { ok: false; error: string };

async function getAgenziaIdLoggata(): Promise<string | null> {
  const session = await auth();
  const u = session?.user;
  if (!u || u.companyType !== 'AGENZIA' || !u.companyId) return null;
  return u.companyId;
}

/** Riprova l'addebito col mandato esistente (l'agenzia ha sistemato con la banca). */
export async function ritentaAddebitoAction(): Promise<RimedioResult> {
  const agenziaId = await getAgenziaIdLoggata();
  if (!agenziaId) return { ok: false, error: 'Non autorizzato' };
  await ritentaAddebitiAgenzia(agenziaId);
  revalidatePath('/blocco-pagamento');
  return { ok: true };
}

/**
 * Valida un IBAN con l'algoritmo MOD97 (ISO 13616).
 * Restituisce true se l'IBAN è strutturalmente valido.
 */
function isIbanMod97Valid(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const ch of numeric) {
    remainder = (remainder * 10 + parseInt(ch, 10)) % 97;
  }
  return remainder === 1;
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
  if (!isIbanMod97Valid(iban)) return { ok: false, error: "IBAN non valido: il checksum non è corretto. Verifica di aver copiato l'IBAN per intero." };

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
  await ritentaAddebitiAgenzia(agenziaId);
  revalidatePath('/blocco-pagamento');
  return { ok: true };
}
