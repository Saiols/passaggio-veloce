import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { descrizioneDocumento } from '@/lib/fatturazione/descrizione';
import { toFatturaPaInput } from '@/lib/fatturazione/xml-mapper';
import { buildFatturaPaXml } from '@/lib/fatturazione/xml-fatturapa';
import { pvEmittente, type DatiFiscali } from '@/lib/fatturazione/pv-emittente';
import { attachmentContentDisposition } from '@/lib/http/content-disposition';
import { canViewDocumentoFiscale, docSedeFields } from '@/lib/fatturazione/access';
import { getSessionContext } from '@/lib/auth/session-context';
import { toSedeScope, NO_SEDE_SCOPE } from '@/lib/sedi/scope-filters';
import { hasPermesso } from '@/lib/auth/permessi/guard';
import { isAdminOrAssistente } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIPI_XML = ['TD01', 'TD06', 'TD04'] as const;
type TipoXml = (typeof TIPI_XML)[number];

/**
 * GET /api/fatturazione/[id]/xml — scarica l'XML FatturaPA del documento.
 * Disponibile solo per i documenti con `fatturaPaTipo` valorizzato (TD01/TD06/
 * TD04): i compensi a broker PRIVATO e le penali non generano XML SDI.
 * Access control identico al PDF (`canViewDocumentoFiscale`): admin, oppure
 * emittente/destinatario E documento agganciato a una sede in scope (pratica o
 * wallet del payout). I documenti senza alcuna sede sono dell'entità legale:
 * solo il proprietario.
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
      pratica: { select: { codicePratica: true, agenziaSedeId: true, brokerSedeId: true } },
      payout: {
        select: {
          eseguitoAt: true,
          transazioni: {
            where: { tipo: 'CREDITO_PRATICA' },
            select: { pratica: { select: { codicePratica: true } } },
          },
          wallet: { select: { sedeId: true } },
        },
      },
      notaVariazionePer: { select: { numeroProgressivo: true, anno: true, numeroDocumentoStr: true } },
    },
  });
  if (!doc) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }

  const isAdmin = session.user.role === 'ADMIN_PIATTAFORMA';
  const ctx = await getSessionContext();
  const allowed = canViewDocumentoFiscale(docSedeFields(doc), {
    companyId: session.user.companyId,
    isAdminPiattaforma: isAdmin,
    scope: ctx ? toSedeScope(ctx) : NO_SEDE_SCOPE,
  });
  if (!allowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Il permesso non sostituisce `canViewDocumentoFiscale` (scope): decide SE
  // l'utente può scaricare l'XML. Bypass esplicito per lo staff di piattaforma
  // (companyId null → nessun permesso azienda).
  if (!isAdminOrAssistente(session.user.role) && !(await hasPermesso('fatture.xml'))) {
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
