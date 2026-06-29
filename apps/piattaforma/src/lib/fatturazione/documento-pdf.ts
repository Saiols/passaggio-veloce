import 'server-only';
import { prisma, type Prisma } from '@pv/db';
import { buildDocumentoPdf, type DocumentoPdfInput } from './pdf';
import { descrizioneDocumento, resolveSedeRiferimento } from './descrizione';
import { labelTipoDocumento } from './format';
import type { DatiFiscali } from './pv-emittente';
import type { EmailAttachment } from '@/lib/providers/email';

/**
 * Include comune per costruire il PDF (copia di cortesia) di un
 * DocumentoFiscale: gli stessi dati servono a `descrizioneDocumento` per
 * comporre descrizione/riferimento. Condiviso tra il route di download e
 * l'allegato email così che il PDF resti identico nei due percorsi.
 */
const sedeSelect = { select: { nome: true, citta: true, provincia: true } } as const;

export const documentoPdfInclude = {
  pratica: {
    select: { codicePratica: true, agenziaSede: sedeSelect, brokerSede: sedeSelect },
  },
  payout: {
    select: {
      eseguitoAt: true,
      transazioni: {
        where: { tipo: 'CREDITO_PRATICA' },
        select: { pratica: { select: { codicePratica: true } } },
      },
      wallet: { select: { sede: sedeSelect } },
    },
  },
  notaVariazionePer: { select: { numeroProgressivo: true, anno: true, numeroDocumentoStr: true } },
} satisfies Prisma.DocumentoFiscaleInclude;

export type DocumentoPdfRecord = Prisma.DocumentoFiscaleGetPayload<{
  include: typeof documentoPdfInclude;
}>;

/** Mappa un DocumentoFiscale (con `documentoPdfInclude`) sull'input del PDF. */
export function documentoPdfInput(doc: DocumentoPdfRecord): DocumentoPdfInput {
  const { descrizione, riferimento } = descrizioneDocumento(doc);
  return {
    tipo: doc.tipo,
    fatturaPaTipo: doc.fatturaPaTipo,
    numeroProgressivo: doc.numeroProgressivo,
    anno: doc.anno,
    emessoAt: doc.emessoAt,
    numeroDocumentoStr: doc.numeroDocumentoStr,
    emittente: doc.datiEmittente as unknown as DatiFiscali,
    destinatario: doc.datiDestinatario as unknown as DatiFiscali,
    imponibileCent: doc.imponibileCent,
    ivaCent: doc.ivaCent,
    aliquotaIvaPct: doc.aliquotaIvaPct,
    importoLordoCent: doc.importoLordoCent,
    descrizione,
    riferimento,
    sede: resolveSedeRiferimento(doc),
  };
}

/** Nome file leggibile, es. "fattura-42-2026.pdf". */
export function documentoPdfFilename(doc: {
  tipo: DocumentoPdfRecord['tipo'];
  numeroProgressivo: number;
  anno: number;
}): string {
  return `${labelTipoDocumento(doc.tipo).replace(/\s+/g, '-').toLowerCase()}-${doc.numeroProgressivo}-${doc.anno}.pdf`;
}

/**
 * Allegato email con il PDF della FATTURA_PV di una pratica. Ritorna `null`
 * se la fattura non esiste ancora (es. fee 0 → nessuna fattura emessa): in tal
 * caso il chiamante invia la mail comunque, senza allegato.
 */
export async function fatturaPvAttachment(praticaId: string): Promise<EmailAttachment | null> {
  const doc = await prisma.documentoFiscale.findFirst({
    where: { praticaId, tipo: 'FATTURA_PV' },
    include: documentoPdfInclude,
  });
  if (!doc) return null;
  const content = await buildDocumentoPdf(documentoPdfInput(doc));
  return { filename: documentoPdfFilename(doc), content, contentType: 'application/pdf' };
}
