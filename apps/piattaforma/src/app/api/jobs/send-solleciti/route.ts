import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sendSolleciti } from '@/lib/jobs/send-solleciti';

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN_PIATTAFORMA') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const result = await sendSolleciti();
  return NextResponse.json({ ok: true, ...result });
}
