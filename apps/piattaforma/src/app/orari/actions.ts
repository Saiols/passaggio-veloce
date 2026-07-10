'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { getOperatingSede } from '@/lib/auth/session-context';
import { requirePermesso } from '@/lib/auth/permessi/guard';
import { prisma, Prisma } from '@pv/db';

type Giorno = 'LUN' | 'MAR' | 'MER' | 'GIO' | 'VEN' | 'SAB' | 'DOM';
const GIORNI: Giorno[] = ['LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB', 'DOM'];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function readFascia(
  form: FormData,
  giorno: Giorno,
  slot: 1 | 2,
): { inizio: string; fine: string } | null {
  const start = String(form.get(`${giorno}_${slot}_start`) ?? '').trim();
  const end = String(form.get(`${giorno}_${slot}_end`) ?? '').trim();
  if (!start && !end) return null;
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) return null;
  if (start >= end) return null;
  return { inizio: start, fine: end };
}

type ActionResult = { ok: true } | { ok: false; error: string };

export async function updateOrariAction(formData: FormData): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };

  // Autenticazione → permesso → scope: il gate di capability precede la
  // risoluzione della sede operativa.
  const gate = await requirePermesso('orari.edit');
  if (!gate.ok) return gate;

  if (session.user.companyType !== 'AGENZIA') {
    return { ok: false, error: 'Solo le agenzie possono modificare gli orari' };
  }
  const agenziaId = session.user.companyId;
  if (!agenziaId) return { ok: false, error: 'Azienda non associata' };

  // Multi-sede: gli orari sono per sede operativa. Il proprietario in vista
  // aggregata (più sedi) deve prima selezionare una sede.
  const sede = await getOperatingSede();
  if (!sede) return { ok: false, error: 'Seleziona una sede per modificarne gli orari' };

  for (const g of GIORNI) {
    const f1 = readFascia(formData, g, 1);
    const f2 = readFascia(formData, g, 2);
    const fasce = [f1, f2].filter((x): x is { inizio: string; fine: string } => x !== null);

    await prisma.orariApertura.upsert({
      where: { sedeId_giorno: { sedeId: sede.id, giorno: g } },
      update: { fasceOrarie: fasce as unknown as Prisma.InputJsonValue },
      create: {
        agenziaId,
        sedeId: sede.id,
        giorno: g,
        fasceOrarie: fasce as unknown as Prisma.InputJsonValue,
      },
    });
  }

  revalidatePath('/orari');
  return { ok: true };
}
