import { NextResponse } from 'next/server';
import { prisma } from '@pv/db';
import { auth } from '@/auth';
import { storageGetBuffer } from '@/lib/providers/storage';
import { buildMandatoFatturazionePdf } from '@/lib/contratti/mandato-pdf';
import { pvEmittente, snapshotCompany } from '@/lib/fatturazione/pv-emittente';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PDF del mandato fatturazione conto terzi per l'AZIENDA dell'utente loggato.
 * Permette al broker/agenzia di PRENDERE VISIONE del documento prima di firmarlo
 * (e di riscaricarlo dopo). Se il mandato è già firmato serve la copia archiviata;
 * altrimenti genera al volo un'ANTEPRIMA compilata coi dati reali dell'azienda
 * (senza firma). Niente companyId in input: si usa sempre quello della sessione.
 */
export async function GET(): Promise<Response> {
  const session = await auth();
  const u = session?.user;
  if (!u || !u.companyId) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const companyId = u.companyId as string;

  // Già firmato → servi la copia archiviata (così è anche riscaricabile dopo).
  const firmato = await prisma.mandatoFatturazione.findUnique({
    where: { companyId },
    select: { storageKey: true },
  });
  if (firmato) {
    const buffer = await storageGetBuffer(firmato.storageKey);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="mandato-fatturazione.pdf"',
        'Cache-Control': 'private, no-store',
      },
    });
  }

  // Non firmato → ANTEPRIMA on-the-fly coi dati reali (stesso testo che si firmerà).
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      ragioneSociale: true,
      partitaIva: true,
      codiceSdi: true,
      pec: true,
      indirizzo: true,
      cap: true,
      citta: true,
      provincia: true,
    },
  });
  if (!company) {
    return new NextResponse('Not found', { status: 404 });
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: u.id as string },
    select: { nome: true, cognome: true },
  });

  const mandatario = pvEmittente();
  const pdfBytes = await buildMandatoFatturazionePdf({
    mandante: snapshotCompany(company),
    mandanteRappresentante: `${dbUser?.nome ?? ''} ${dbUser?.cognome ?? ''}`.trim(),
    mandatario,
    mandatarioRappresentante: process.env.PV_RAPPRESENTANTE ?? 'Andrea Saino',
    foro: mandatario.citta || 'Milano',
    // firmatoAt assente → variante ANTEPRIMA (nessuna firma fabbricata).
  });

  return new NextResponse(new Uint8Array(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="mandato-fatturazione-anteprima.pdf"',
      'Cache-Control': 'private, no-store',
    },
  });
}
