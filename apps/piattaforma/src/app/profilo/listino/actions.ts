'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { getStorage } from '@/lib/providers/storage';

const ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_LISTINO_BYTES = 10 * 1024 * 1024; // 10 MB

const FORM_SCHEMA = z.object({
  prezzoBaseTrapassoEuro: z.coerce.number().min(0).max(10000),
  prezzoMinivolturaEuro: z.coerce.number().min(0).max(10000),
  pre2015MaggiorazionEuro: z.coerce.number().min(0).max(1000).default(0),
  lottoMassivoMaggiorazionEuro: z.coerce.number().min(-100).max(100).default(0),
  provincieCopertura: z.string().trim().max(500),
});

type Result = { ok: true } | { ok: false; error: string };

/**
 * Salva il listino in formato strutturato (FORM_STRUTTURATO).
 */
export async function saveListinoFormAction(
  raw: unknown,
): Promise<Result> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.companyType !== 'AGENZIA') {
    return { ok: false, error: 'Solo le agenzie possono pubblicare un listino.' };
  }
  const agenziaId = session.user.companyId!;

  const parsed = FORM_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join('.')}: ${first.message}` : 'Dati non validi',
    };
  }
  const d = parsed.data;
  const provincieCopertura = d.provincieCopertura
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));

  if (provincieCopertura.length === 0) {
    return {
      ok: false,
      error: 'Inserisci almeno una sigla provincia (es. PD, VE, TV).',
    };
  }

  await prisma.listino.upsert({
    where: { id: await getOrCreateListinoId(agenziaId) },
    create: {
      agenziaId,
      formato: 'FORM_STRUTTURATO',
      prezzoBaseTrapassoCent: Math.round(d.prezzoBaseTrapassoEuro * 100),
      prezzoMinivolturaCent: Math.round(d.prezzoMinivolturaEuro * 100),
      maggiorazioni: {
        pre2015: Math.round(d.pre2015MaggiorazionEuro * 100),
        lottoMassivo: Math.round(d.lottoMassivoMaggiorazionEuro * 100),
      },
      provincieCopertura,
    },
    update: {
      formato: 'FORM_STRUTTURATO',
      prezzoBaseTrapassoCent: Math.round(d.prezzoBaseTrapassoEuro * 100),
      prezzoMinivolturaCent: Math.round(d.prezzoMinivolturaEuro * 100),
      maggiorazioni: {
        pre2015: Math.round(d.pre2015MaggiorazionEuro * 100),
        lottoMassivo: Math.round(d.lottoMassivoMaggiorazionEuro * 100),
      },
      provincieCopertura,
      documentoStorageKey: null, // se passa da UPLOAD a FORM, libero il file
    },
  });

  revalidatePath('/profilo/listino');
  revalidatePath('/dashboard');
  return { ok: true };
}

/**
 * Salva il listino come upload PDF/immagine.
 */
export async function uploadListinoFileAction(
  formData: FormData,
): Promise<Result> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.companyType !== 'AGENZIA') {
    return { ok: false, error: 'Solo le agenzie possono pubblicare un listino.' };
  }
  const agenziaId = session.user.companyId!;

  const file = formData.get('file');
  const provincieRaw = formData.get('provincieCopertura');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'File non selezionato.' };
  }
  if (file.size > MAX_LISTINO_BYTES) {
    return { ok: false, error: 'File troppo grande (max 10 MB).' };
  }
  if (!ACCEPTED_MIME.includes(file.type)) {
    return { ok: false, error: 'Formato non supportato (PDF/JPG/PNG).' };
  }

  const provincieCopertura = String(provincieRaw ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));
  if (provincieCopertura.length === 0) {
    return {
      ok: false,
      error: 'Inserisci almeno una sigla provincia (es. PD, VE, TV).',
    };
  }

  const storage = getStorage();
  const buf = Buffer.from(await file.arrayBuffer());
  const put = await storage.put({
    scope: `listini/${agenziaId}`,
    buffer: buf,
    originalFilename: file.name,
    mimeType: file.type,
  });

  await prisma.listino.upsert({
    where: { id: await getOrCreateListinoId(agenziaId) },
    create: {
      agenziaId,
      formato: 'UPLOAD_FILE',
      documentoStorageKey: put.storageKey,
      provincieCopertura,
    },
    update: {
      formato: 'UPLOAD_FILE',
      documentoStorageKey: put.storageKey,
      // Mantieni i prezzi se erano stati impostati prima (caso ibrido)
      provincieCopertura,
    },
  });

  revalidatePath('/profilo/listino');
  return { ok: true };
}

export async function deleteListinoAction(): Promise<Result> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.companyType !== 'AGENZIA') {
    return { ok: false, error: 'Solo le agenzie possono cancellare il listino.' };
  }
  const agenziaId = session.user.companyId!;

  const existing = await prisma.listino.findFirst({
    where: { agenziaId },
    select: { id: true },
  });
  if (existing) {
    await prisma.listino.delete({ where: { id: existing.id } });
  }
  revalidatePath('/profilo/listino');
  return { ok: true };
}

async function getOrCreateListinoId(agenziaId: string): Promise<string> {
  const existing = await prisma.listino.findFirst({
    where: { agenziaId },
    select: { id: true },
  });
  if (existing) return existing.id;
  // Crea uno placeholder per upsert (evita race su create)
  const created = await prisma.listino.create({
    data: {
      agenziaId,
      formato: 'FORM_STRUTTURATO',
      provincieCopertura: [],
    },
    select: { id: true },
  });
  return created.id;
}
