import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { getStorage, StorageNotFoundError } from '@/lib/providers/storage';
import { documentoDownloadName } from '@/lib/documenti/labels';
import { getSessionContext } from '@/lib/auth/session-context';
import { toSedeScope, NO_SEDE_SCOPE } from '@/lib/sedi/scope-filters';
import { canAccessDocumento } from '@/lib/pratiche/access';
import { hasPermesso } from '@/lib/auth/permessi/guard';
import { isAdminOrAssistente } from '@/lib/auth/permissions';
import { registraLogAsync } from '@/lib/audit/log-accessi';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const doc = await prisma.documento.findUnique({
    where: { id },
    select: {
      id: true,
      praticaId: true,
      companyId: true,
      storageKey: true,
      mimeType: true,
      tipo: true,
      owner: true,
      originalFilename: true,
      pratica: {
        select: {
          brokerId: true,
          agenziaAssegnataId: true,
          brokerSedeId: true,
          agenziaSedeId: true,
          codicePratica: true,
        },
      },
      company: {
        select: {
          ragioneSociale: true,
        },
      },
    },
  });

  if (!doc) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // ⚠️ SOLO ADMIN_PIATTAFORMA, MAI `isAdminOrAssistente` (usata invece 21 righe
  // sotto per un gate diverso): questa è l'unica cosa che nega all'ASSISTENTE i
  // documenti aziendali (CI/visura del legale rappresentante) di TUTTE le
  // aziende. `canAccessDocumento` concede l'accesso incondizionato quando
  // `isAdminPiattaforma` è true (bypassa anche il match su `companyId`), quindi
  // "uniformare" questa riga a `isAdminOrAssistente` — le due righe sembrano
  // un'incoerenza da sistemare, ma non lo sono — aprirebbe la carta d'identità
  // di ogni azienda della piattaforma all'ASSISTENTE. Regressione blindata da
  // route.authz.test.ts (mutation-tested: verificato rosso→verde a mano).
  const isAdmin = session.user.role === 'ADMIN_PIATTAFORMA';
  const userCompanyId = session.user.companyId;
  const ctx = await getSessionContext();
  const scope = ctx ? toSedeScope(ctx) : NO_SEDE_SCOPE;

  // Regole (testate in lib/pratiche/access.test.ts): admin sempre; documento
  // aziendale (visura/CI del legale rappresentante, nessuna pratica) al solo
  // proprietario; documento di pratica secondo `canAccessPratica`.
  const allowed = canAccessDocumento(doc, {
    companyId: userCompanyId,
    isAdminPiattaforma: isAdmin,
    scope,
  });

  // Log accessi (art. 32 GDPR). Questa route è la ragione principale per cui
  // il log esiste: è l'unico punto in cui qualcuno legge i documenti
  // d'identità di venditori e acquirenti — persone che con noi non hanno
  // alcun rapporto — e l'unico modo di rispondere a «chi ha visto i miei
  // documenti». `bersaglioCompanyId` isola il caso che conta: lo staff di
  // piattaforma, o un admin, che apre il documento di un'altra azienda.
  const bersaglioCompanyId =
    doc.companyId ?? doc.pratica?.brokerId ?? doc.pratica?.agenziaAssegnataId ?? null;
  const vocePerDocumento = {
    azione: 'DOCUMENTO_ACCESSO' as const,
    userId: session.user.id,
    email: session.user.email,
    companyId: userCompanyId ?? null,
    bersaglioCompanyId: bersaglioCompanyId === userCompanyId ? null : bersaglioCompanyId,
    risorsaTipo: 'documento',
    risorsaId: doc.id,
    // Esplicito e non lasciato al default: «questo accesso è stato
    // consentito» è un'affermazione del log, non un'omissione. I due rami di
    // rifiuto qui sotto lo sovrascrivono con lo spread.
    negato: false,
  };

  if (!allowed) {
    // Il tentativo NEGATO è il segnale più utile dell'intero log: dice che
    // qualcuno ha provato ad aprire un documento che non gli spetta.
    registraLogAsync({ ...vocePerDocumento, negato: true, dettaglio: 'scope o proprietà' });
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Il permesso non sostituisce `canAccessDocumento` (scope): decide SE
  // l'utente può scaricare. Bypass esplicito per lo staff di piattaforma
  // (companyId null → nessun permesso azienda). Qui `isAdminOrAssistente` è
  // corretto (a differenza di `isAdmin` sopra): questo gate NON decide QUALE
  // documento è visibile (lo ha già deciso `canAccessDocumento`, che nega
  // sempre l'ASSISTENTE sui documenti aziendali), decide solo SE chi ha già il
  // via libera deve avere anche il permesso `pratiche.download` — e l'ASSISTENTE,
  // come l'admin, lo ha sempre implicitamente (non ha un'azienda su cui
  // verificare un permesso). Le due righe restano diverse di proposito.
  if (!isAdminOrAssistente(session.user.role) && !(await hasPermesso('pratiche.download'))) {
    registraLogAsync({
      ...vocePerDocumento,
      negato: true,
      dettaglio: 'permesso pratiche.download mancante',
    });
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Registrato PRIMA di servire il file, non dopo: la risposta è uno stream e
  // il chiamante ha già i byte quando la promise del body si risolve. Loggare
  // in coda significherebbe non registrare nulla se il processo termina a
  // metà download — e il caso interessante è proprio quello anomalo.
  registraLogAsync(vocePerDocumento);

  try {
    const file = await getStorage().get(doc.storageKey);
    // Nome file = "<numero pratica> - <label documento>": non esponiamo mai il
    // nome file originale caricato dall'utente. Documento AZIENDALE (nessuna
    // pratica, CI/codice fiscale/visura del legale rappresentante): niente
    // codicePratica da usare, si usa la ragione sociale al suo posto — senza
    // questo, tutti i documenti aziendali di aziende diverse si chiamerebbero
    // "documento - ..." e si sovrascriverebbero in Downloads. Il codicePratica
    // ha sempre la precedenza quando esiste una pratica.
    const filename = documentoDownloadName(doc, {
      codicePratica: doc.pratica?.codicePratica ?? doc.company?.ragioneSociale ?? null,
    });
    const headers = new Headers();
    headers.set('Content-Type', doc.mimeType);
    headers.set(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    headers.set('Content-Length', String(file.sizeBytes));
    headers.set('Cache-Control', 'private, no-store');

    // Convert Node.js Readable to Web ReadableStream (Node 18+)
    const webStream = Readable.toWeb(file.stream) as ReadableStream;

    return new Response(webStream, { headers });
  } catch (err) {
    if (err instanceof StorageNotFoundError) {
      return NextResponse.json({ error: 'file_not_found' }, { status: 404 });
    }
    throw err;
  }
}
