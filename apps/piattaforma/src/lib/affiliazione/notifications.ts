import 'server-only';
import { prisma } from '@pv/db';
import { sendNotification } from '@/lib/notifiche';

/**
 * Helper per le notifiche AF-N (FASE 13). Best-effort: gli errori non
 * bloccano il flusso chiamante.
 */

async function getCompanyAdmin(companyId: string): Promise<{
  email: string;
  userId: string;
  nome: string;
} | null> {
  const admin = await prisma.user.findFirst({
    where: {
      companyId,
      role: 'ADMIN_AZIENDA',
      status: 'ACTIVE',
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, nome: true },
  });
  if (!admin) return null;
  return { userId: admin.id, email: admin.email, nome: admin.nome };
}

/**
 * N22 — Notifica al referente che un nuovo iscritto si è registrato col suo link.
 * Da chiamare best-effort post-registrazione, dopo che la Company nuova è creata
 * con `referenteId` valorizzato.
 */
export async function notifyReferralSignup(newCompanyId: string): Promise<void> {
  try {
    const newCompany = await prisma.company.findUnique({
      where: { id: newCompanyId },
      select: {
        ragioneSociale: true,
        type: true,
        citta: true,
        provincia: true,
        referenteId: true,
      },
    });
    if (!newCompany?.referenteId) return;

    const referenteAdmin = await getCompanyAdmin(newCompany.referenteId);
    if (!referenteAdmin) return;

    await sendNotification({
      tipo: 'N22_REFERRAL_SIGNUP',
      target: {
        email: referenteAdmin.email,
        userId: referenteAdmin.userId,
        companyId: newCompany.referenteId,
      },
      payload: {
        nomeReferente: referenteAdmin.nome,
        referralRagioneSociale: newCompany.ragioneSociale,
        tipoReferral: newCompany.type === 'DEALER' ? 'BROKER' : 'AGENZIA',
        citta: newCompany.citta,
        provincia: newCompany.provincia,
      },
    });
  } catch {
    // best-effort
  }
}

/**
 * N23 — Notifica al referente che il proprio referral ha firmato la PRIMA
 * pratica. Da chiamare best-effort post-firma; passa l'importo della
 * commissione appena accreditata.
 */
export async function notifyReferralFirstPratica(input: {
  brokerCompanyId: string;
  codicePratica: string;
  importoCommissioneCent: number;
}): Promise<void> {
  try {
    const broker = await prisma.company.findUnique({
      where: { id: input.brokerCompanyId },
      select: {
        ragioneSociale: true,
        type: true,
        referenteId: true,
      },
    });
    if (!broker?.referenteId) return;

    const referenteAdmin = await getCompanyAdmin(broker.referenteId);
    if (!referenteAdmin) return;

    await sendNotification({
      tipo: 'N23_REFERRAL_FIRST_PRATICA',
      target: {
        email: referenteAdmin.email,
        userId: referenteAdmin.userId,
        companyId: broker.referenteId,
      },
      payload: {
        nomeReferente: referenteAdmin.nome,
        referralRagioneSociale: broker.ragioneSociale,
        tipoReferral: broker.type === 'DEALER' ? 'BROKER' : 'AGENZIA',
        codicePratica: input.codicePratica,
        importoCommissioneCent: input.importoCommissioneCent,
      },
    });
  } catch {
    // best-effort
  }
}

/**
 * N24 — Notifica al referente che il wallet ha attraversato la soglia di payout.
 * Triggered da accredit affiliazione che fa "scattare" il valore.
 *
 * @param referenteCompanyId Company del referente che riceve la notifica
 * @param prevSaldoCent Saldo wallet PRIMA dell'accredit
 * @param newSaldoCent Saldo wallet DOPO l'accredit
 */
export async function notifyPayoutThresholdCrossed(input: {
  referenteCompanyId: string;
  prevSaldoCent: number;
  newSaldoCent: number;
}): Promise<void> {
  try {
    const company = await prisma.company.findUnique({
      where: { id: input.referenteCompanyId },
      select: { payoutThresholdCent: true },
    });
    if (!company) return;

    const soglia = company.payoutThresholdCent;
    // Cross-over: solo se prima era sotto soglia e ora la supera.
    if (input.prevSaldoCent >= soglia || input.newSaldoCent < soglia) return;

    const admin = await getCompanyAdmin(input.referenteCompanyId);
    if (!admin) return;

    await sendNotification({
      tipo: 'N24_PAYOUT_AFFILIATION_AVAILABLE',
      target: {
        email: admin.email,
        userId: admin.userId,
        companyId: input.referenteCompanyId,
      },
      payload: {
        nomeReferente: admin.nome,
        saldoWalletCent: input.newSaldoCent,
        sogliaCent: soglia,
      },
    });
  } catch {
    // best-effort
  }
}
