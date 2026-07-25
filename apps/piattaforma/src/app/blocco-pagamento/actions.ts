'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@pv/db';
import { auth } from '@/auth';
import { isOwner as isOwnerRole } from '@/lib/auth/permissions';
import { requireOperativita } from '@/lib/auth/sospensione-guard';
import { ritentaAddebitiAgenzia } from '@/lib/fee/retry';
import { applySepaMandateToAgency } from '@/lib/providers/payment/stripe-mandate';

export type RimedioResult = { ok: true } | { ok: false; error: string };

type AgenziaContext = { agenziaId: string; isOwner: boolean };

async function getAgenziaContext(): Promise<AgenziaContext | null> {
  const session = await auth();
  const u = session?.user;
  if (!u || u.companyType !== 'AGENZIA' || !u.companyId) return null;
  return { agenziaId: u.companyId, isOwner: isOwnerRole(u.role) };
}

/**
 * Riprova l'addebito col mandato esistente (l'agenzia ha sistemato con la banca).
 * Aperta a tutta l'agenzia: non tocca IBAN né importi, rilancia un addebito
 * già dovuto. È il rimedio al caso più frequente (banca sistemata, IBAN invariato).
 */
export async function ritentaAddebitoAction(): Promise<RimedioResult> {
  const ctx = await getAgenziaContext();
  if (!ctx) return { ok: false, error: 'Non autorizzato' };
  await ritentaAddebitiAgenzia(ctx.agenziaId);
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
  // Rimuove tutti gli spazi interni (IBAN incollati con spazi tipo "IT60 X054 ...") PRIMA
  // della validazione min/max, poi uppercasa. L'IBAN risultante è privo di spazi.
  iban: z.preprocess(
    (v) => (typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : v),
    z.string().min(15).max(34),
  ),
});

/**
 * Aggiorna l'IBAN, ri-crea il mandato SEPA, poi riprova l'addebito.
 *
 * Riservata al titolare dell'account (ADMIN_AZIENDA): riscrive l'IBAN
 * dell'azienda madre — quello su cui arrivano i payout — e riappoggia il
 * mandato SEPA sul nuovo conto. Un ADMIN_SEDE o un operatore non ci arriva.
 *
 * BLOCCATA sotto sospensione, a differenza della sorella `ritentaAddebitoAction`:
 * questa è l'unica via rimasta per riscrivere `Company.iban`, cioè il conto che
 * `resolveIban()` legge in `settlePayout` (lib/wallet/payout-exec.ts). Le altre
 * due sono già chiuse (`updateCompanyProfileAction` → guard qui sotto,
 * `updateSedeAction` → gated `sede.edit`, chiave di scrittura). Lasciandola
 * aperta, un sospeso riscriveva l'IBAN e il residuo della liquidazione di
 * cessazione — che passa da `eseguiPayoutImmediato(..., { ignoraSoglia: true })`
 * e per progetto ignora la sospensione, clausola 12.4 — finiva su un conto
 * scritto DOPO la misura. Il rimedio non muore: `ritentaAddebitoAction` resta
 * consentita e copre il caso comune (banca sistemata, IBAN invariato).
 */
export async function aggiornaIbanERitentaAction(formData: FormData): Promise<RimedioResult> {
  const ctx = await getAgenziaContext();
  if (!ctx) return { ok: false, error: 'Non autorizzato' };
  if (!ctx.isOwner) {
    return { ok: false, error: "Solo il titolare dell'account può aggiornare l'IBAN" };
  }
  const op = await requireOperativita();
  if (!op.ok) return { ok: false, error: op.error };
  const agenziaId = ctx.agenziaId;

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
