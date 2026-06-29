import 'server-only';
import { prisma, type Prisma } from '@pv/db';
import { splitImporto, fatturaPaTipoPerRegime } from './calcolo';
import { prossimoContatore } from './numerazione';
import { numeroDocumento } from './format';
import { pvEmittente, snapshotCompany, type DatiFiscali } from './pv-emittente';

const ID_SOGGETTO_PV = 'PV';

/**
 * FATTURA_PV verso l'agenzia, generata alla firma. Importo = feeAgenziaCent
 * (PV regime ordinario → IVA 22% scorporata). Idempotente per pratica.
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
    const num = await prossimoContatore(tx, ID_SOGGETTO_PV, 'FATTURA_PV', anno);
    const numeroStr = numeroDocumento({ tipo: 'FATTURA_PV', numeroProgressivo: num, anno });

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
        numeroDocumentoStr: numeroStr,
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
 * del payout, tipo per regime del broker. Emittente = broker (madre), destinatario
 * = PV (snapshot). Numerato sul registro del broker. Idempotente per payout.
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
    const broker = payout.wallet.sede?.company ?? payout.wallet.company;
    if (!broker) return;

    const lordo = payout.transazioni
      .filter((t) => t.tipo === 'CREDITO_PRATICA')
      .reduce((s, t) => s + t.importoCent, 0);
    if (lordo <= 0) return;

    const regime = broker.regimeFiscale;
    const split = splitImporto(lordo, regime);
    const tipoXml = fatturaPaTipoPerRegime('DOC_BROKER', regime);
    const num = await prossimoContatore(tx, broker.id, 'DOC_BROKER', anno);
    const numeroStr = numeroDocumento({
      tipo: 'DOC_BROKER',
      numeroProgressivo: num,
      anno,
      emittenteNumeroSoggetto: broker.numeroSoggetto,
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
        numeroProgressivo: num,
        anno,
        numeroDocumentoStr: numeroStr,
        importoLordoCent: lordo,
        imponibileCent: split.imponibileCent,
        ivaCent: split.ivaCent,
        aliquotaIvaPct: split.aliquotaIvaPct,
      },
    });
  });
}

/**
 * NOTA_VARIAZIONE (TD04, importi negativi) su un documento esistente. Numerata su
 * sequenza NOTA_CREDITO separata, nel registro dell'emittente dell'originale (PV o
 * broker). Marca l'originale STORNATA.
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
    if (orig.statoPagamento === 'STORNATA') return;

    const isPv = orig.emittenteCompanyId == null;
    const idSoggetto = isPv ? ID_SOGGETTO_PV : orig.emittenteCompanyId!;
    const em = isPv
      ? null
      : await tx.company.findUnique({
          where: { id: orig.emittenteCompanyId! },
          select: { numeroSoggetto: true },
        });
    if (!isPv && em == null) throw new Error('Emittente del documento originale non trovato');
    const num = await prossimoContatore(tx, idSoggetto, 'NOTA_CREDITO', anno);
    const numeroStr = numeroDocumento({
      tipo: 'NOTA_VARIAZIONE',
      numeroProgressivo: num,
      anno,
      emittenteNumeroSoggetto: em?.numeroSoggetto ?? null,
    });

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
        anno,
        numeroDocumentoStr: numeroStr,
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
