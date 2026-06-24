import 'server-only';
import { prisma, type Prisma } from '@pv/db';
import { splitImporto, fatturaPaTipoPerRegime } from './calcolo';
import { prossimoNumero } from './numerazione';
import { pvEmittente, snapshotCompany, type DatiFiscali } from './pv-emittente';

/** Prossimo numero nel registro PV (documenti con emittente PV = emittenteCompanyId null). */
async function nextNumeroPv(tx: Prisma.TransactionClient, anno: number): Promise<number> {
  const agg = await tx.documentoFiscale.aggregate({
    where: { emittenteCompanyId: null, anno },
    _max: { numeroProgressivo: true },
  });
  return (agg._max.numeroProgressivo ?? 0) + 1;
}

/**
 * FATTURA_PV verso l'agenzia, generata alla firma. Importo = feeAgenziaCent
 * (PV è regime ordinario → IVA 22% scorporata). Idempotente per pratica.
 */
export async function createFatturaPv(input: {
  praticaId: string;
  agenziaId: string;
  feeAgenziaCent: number;
}): Promise<void> {
  if (input.feeAgenziaCent <= 0) return;
  const anno = new Date().getFullYear();
  await prisma.$transaction(async (tx) => {
    const esiste = await tx.documentoFiscale.findFirst({
      where: { praticaId: input.praticaId, tipo: 'FATTURA_PV' },
      select: { id: true },
    });
    if (esiste) return;
    const agenzia = await tx.company.findUnique({ where: { id: input.agenziaId } });
    if (!agenzia) return;

    const split = splitImporto(input.feeAgenziaCent, 'ORDINARIO');
    const num = await nextNumeroPv(tx, anno);

    await tx.documentoFiscale.create({
      data: {
        tipo: 'FATTURA_PV',
        fatturaPaTipo: 'TD01',
        praticaId: input.praticaId,
        emittenteCompanyId: null,
        destinatarioCompanyId: agenzia.id,
        datiEmittente: pvEmittente() as unknown as Prisma.InputJsonValue,
        datiDestinatario: snapshotCompany(agenzia) as unknown as Prisma.InputJsonValue,
        numeroProgressivo: num,
        anno,
        importoLordoCent: input.feeAgenziaCent,
        imponibileCent: split.imponibileCent,
        ivaCent: split.ivaCent,
        aliquotaIvaPct: split.aliquotaIvaPct,
        statoPagamento: 'IN_ATTESA',
      },
    });
  });
}

/**
 * DOC_BROKER (conto terzi) aggregato al payout: importo = somma dei CREDITO_PRATICA
 * del payout, tipo per regime del broker. Emittente = broker, destinatario = PV
 * (snapshot). Numerato sul registro del broker. Idempotente per payout.
 */
export async function createDocBroker(input: { payoutId: string }): Promise<void> {
  const anno = new Date().getFullYear();
  await prisma.$transaction(async (tx) => {
    const esiste = await tx.documentoFiscale.findFirst({
      where: { payoutId: input.payoutId, tipo: 'DOC_BROKER' },
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
    // Multi-sede: il broker (soggetto fiscale = madre) è la company della sede
    // del wallet operativo; per il wallet affiliazione madre è company diretta.
    const broker = payout.wallet.sede?.company ?? payout.wallet.company;
    if (!broker) return;

    const lordo = payout.transazioni
      .filter((t) => t.tipo === 'CREDITO_PRATICA')
      .reduce((s, t) => s + t.importoCent, 0);
    if (lordo <= 0) return;

    const regime = broker.regimeFiscale;
    const split = splitImporto(lordo, regime);
    const tipoXml = fatturaPaTipoPerRegime('DOC_BROKER', regime);
    const prox = prossimoNumero(
      { anno: broker.numeratoreFiscaleAnno, num: broker.numeratoreFiscaleNum },
      anno,
    );
    await tx.company.update({
      where: { id: broker.id },
      data: { numeratoreFiscaleAnno: prox.anno, numeratoreFiscaleNum: prox.num },
    });

    await tx.documentoFiscale.create({
      data: {
        tipo: 'DOC_BROKER',
        fatturaPaTipo: tipoXml,
        payoutId: payout.id,
        emittenteCompanyId: broker.id,
        destinatarioCompanyId: null,
        datiEmittente: snapshotCompany(broker) as unknown as Prisma.InputJsonValue,
        datiDestinatario: pvEmittente() as unknown as Prisma.InputJsonValue,
        numeroProgressivo: prox.num,
        anno: prox.anno,
        importoLordoCent: lordo,
        imponibileCent: split.imponibileCent,
        ivaCent: split.ivaCent,
        aliquotaIvaPct: split.aliquotaIvaPct,
      },
    });
  });
}

/**
 * NOTA_VARIAZIONE (TD04, importi negativi) su un documento esistente. Numerata
 * sullo stesso registro dell'emittente dell'originale; marca l'originale STORNATA.
 */
export async function createNotaCredito(input: {
  documentoOriginaleId: string;
}): Promise<void> {
  const anno = new Date().getFullYear();
  await prisma.$transaction(async (tx) => {
    const orig = await tx.documentoFiscale.findUnique({
      where: { id: input.documentoOriginaleId },
    });
    if (!orig || orig.tipo === 'NOTA_VARIAZIONE') return;

    let num: number;
    let annoN = anno;
    if (orig.emittenteCompanyId == null) {
      num = await nextNumeroPv(tx, anno);
    } else {
      const em = await tx.company.findUnique({ where: { id: orig.emittenteCompanyId } });
      const prox = prossimoNumero(
        { anno: em?.numeratoreFiscaleAnno ?? null, num: em?.numeratoreFiscaleNum ?? null },
        anno,
      );
      await tx.company.update({
        where: { id: orig.emittenteCompanyId },
        data: { numeratoreFiscaleAnno: prox.anno, numeratoreFiscaleNum: prox.num },
      });
      num = prox.num;
      annoN = prox.anno;
    }

    await tx.documentoFiscale.create({
      data: {
        tipo: 'NOTA_VARIAZIONE',
        fatturaPaTipo: 'TD04',
        praticaId: orig.praticaId,
        payoutId: orig.payoutId,
        emittenteCompanyId: orig.emittenteCompanyId,
        destinatarioCompanyId: orig.destinatarioCompanyId,
        datiEmittente: orig.datiEmittente as Prisma.InputJsonValue,
        datiDestinatario: orig.datiDestinatario as Prisma.InputJsonValue,
        numeroProgressivo: num,
        anno: annoN,
        importoLordoCent: -orig.importoLordoCent,
        imponibileCent: orig.imponibileCent == null ? null : -orig.imponibileCent,
        ivaCent: orig.ivaCent == null ? null : -orig.ivaCent,
        aliquotaIvaPct: orig.aliquotaIvaPct,
        notaVariazionePerId: orig.id,
      },
    });

    await tx.documentoFiscale.update({
      where: { id: orig.id },
      data: { statoPagamento: 'STORNATA' },
    });
  });
}

export type { DatiFiscali };
