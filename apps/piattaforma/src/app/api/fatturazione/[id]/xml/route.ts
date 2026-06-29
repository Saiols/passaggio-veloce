import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { descrizioneDocumento } from '@/lib/fatturazione/descrizione';
import { toFatturaPaInput } from '@/lib/fatturazione/xml-mapper';
import { buildFatturaPaXml } from '@/lib/fatturazione/xml-fatturapa';
import { pvEmittente, type DatiFiscali } from '@/lib/fatturazione/pv-emittente';
import { attachmentContentDisposition } from '@/lib/http/content-disposition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIPI_XML = ['TD01', 'TD06', 'TD04'] as const;
type TipoXml = (typeof TIPI_XML)[number];

/**
 * GET /api/fatturazione/[id]/xml — scarica l'XML FatturaPA del documento.
 * Disponibile solo per i documenti con `fatturaPaTipo` valorizzato (TD01/TD06/
 * TD04): i compensi a broker PRIVATO e le penali non generano XML SDI.
 * Access control identico al PDF: admin, oppure emittente/destinatario.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const doc = await prisma.documentoFiscale.findUnique({
    where: { id },
    include: {
      pratica: { select: { codicePratica: true } },
      payout: {
        select: {
          eseguitoAt: true,
          transazioni: {
            where: { tipo: 'CREDITO_PRATICA' },
            select: { pratica: { select: { codicePratica: true } } },
          },
        },
      },
      notaVariazionePer: { select: { numeroProgressivo: true, anno: true, numeroDocumentoStr: true } },
    },
  });
  if (!doc) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const isAdmin = session.user.role === 'ADMIN_PIATTAFORMA';
  const cid = session.user.companyId;
  const allowed =
    isAdmin ||
    (doc.emittenteCompanyId != null && doc.emittenteCompanyId === cid) ||
    (doc.destinatarioCompanyId != null && doc.destinatarioCompanyId === cid);
  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (!doc.fatturaPaTipo || !(TIPI_XML as readonly string[]).includes(doc.fatturaPaTipo)) {
    return NextResponse.json({ error: 'xml-non-disponibile' }, { status: 404 });
  }

  const { descrizione, riferimento } = descrizioneDocumento(doc);

  const input = toFatturaPaInput({
    fatturaPaTipo: doc.fatturaPaTipo as TipoXml,
    numero: doc.numeroDocumentoStr ?? '',
    numeroProgressivo: doc.numeroProgressivo,
    data: doc.emessoAt,
    emittente: doc.datiEmittente as unknown as DatiFiscali,
    destinatario: doc.datiDestinatario as unknown as DatiFiscali,
    emittenteIsPv: doc.emittenteCompanyId == null,
    imponibileCent: doc.imponibileCent,
    ivaCent: doc.ivaCent,
    aliquotaIvaPct: doc.aliquotaIvaPct,
    descrizione,
    causale: riferimento ? riferimento.slice(0, 200) : null,
    pv: pvEmittente(),
  });

  const xml = buildFatturaPaXml(input);
  const filename = `IT${input.idTrasmittente.idCodice}_${input.progressivoInvio}.xml`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': attachmentContentDisposition(filename),
      'Cache-Control': 'private, no-store',
    },
  });
}
