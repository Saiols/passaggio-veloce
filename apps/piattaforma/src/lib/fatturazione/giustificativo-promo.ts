import 'server-only';
import { prisma, type Prisma } from '@pv/db';
import { prossimoContatore } from './numerazione';
import { numeroGiustificativo } from './format';
import { snapshotCompany } from './pv-emittente';
import { formatDate } from '@/lib/format';

const ID_SOGGETTO_PV = 'PV';

type RigaGiustificativo = {
  code: string;
  dataIscrizione: string; // ISO
  amountCent: number;
  redemptionId: string;
};

/**
 * Giustificativo interno di costo per il bonus promozionale incassato in un
 * payout ("Documento 2", art. 108 TUIR). NON è un documento fiscale, non va
 * allo SdI. Importo = somma delle CREDITO_PROMO agganciate al payout; risale ai
 * PromoCodeRedemption (via transazioneWalletId) per il log. Idempotente per
 * payout (payoutId unique). Payout senza promo → nessun record.
 */
export async function createGiustificativoPromo(input: { payoutId: string }): Promise<void> {
  const anno = new Date().getFullYear();
  await prisma.$transaction(async (tx) => {
    const esiste = await tx.giustificativoInterno.findFirst({
      where: { payoutId: input.payoutId },
      select: { id: true },
    });
    if (esiste) return;

    const payout = await tx.payout.findUnique({
      where: { id: input.payoutId },
      include: {
        wallet: { include: { sede: { include: { company: true } }, company: true } },
        transazioni: true,
      },
    });
    if (!payout) return;

    const promoTx = payout.transazioni.filter((t) => t.tipo === 'CREDITO_PROMO');
    const importoCent = promoTx.reduce((s, t) => s + t.importoCent, 0);
    if (importoCent <= 0) return;

    const beneficiario = payout.wallet.sede?.company ?? payout.wallet.company;
    if (!beneficiario) return;

    const redemptions = await tx.promoCodeRedemption.findMany({
      where: { transazioneWalletId: { in: promoTx.map((t) => t.id) } },
      include: { promoCode: { select: { code: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const righe: RigaGiustificativo[] = redemptions.map((r) => ({
      code: r.promoCode.code,
      dataIscrizione: r.createdAt.toISOString(),
      amountCent: r.amountCent,
      redemptionId: r.id,
    }));

    const dati = snapshotCompany(beneficiario);
    const dataRif = redemptions[0]?.createdAt ?? payout.eseguitoAt ?? new Date();
    const causale = `Bonus promozionale iscrizione — ${dati.ragioneSociale} — ${formatDate(dataRif)}`;

    const num = await prossimoContatore(tx, ID_SOGGETTO_PV, 'GIUSTIFICATIVO_INTERNO', anno);
    const numeroStr = numeroGiustificativo(anno, num);

    await tx.giustificativoInterno.create({
      data: {
        tipo: 'COSTO_PROMO',
        numeroProgressivo: num,
        anno,
        numeroStr,
        importoCent,
        causale,
        payoutId: payout.id,
        beneficiarioCompanyId: beneficiario.id,
        datiBeneficiario: dati as unknown as Prisma.InputJsonValue,
        righe: righe as unknown as Prisma.InputJsonValue,
      },
    });
  });
}
