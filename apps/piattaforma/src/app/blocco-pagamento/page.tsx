import { redirect } from 'next/navigation';
import { prisma } from '@pv/db';
import { auth } from '@/auth';
import { BloccoPagamentoClient } from './client';

export default async function BloccoPagamentoPage() {
  const session = await auth();
  const u = session?.user;
  if (!u) redirect('/login');
  if (u.companyType !== 'AGENZIA' || !u.companyId) redirect('/dashboard');

  const agenzia = await prisma.company.findUnique({
    where: { id: u.companyId },
    select: { bloccoPagamentoAt: true, bloccoPagamentoMotivo: true, iban: true },
  });
  // Non bloccata → torna all'operatività.
  if (!agenzia?.bloccoPagamentoAt) redirect('/dashboard');

  const [scoperti, inVolo] = await Promise.all([
    prisma.feeAddebito.count({ where: { agenziaId: u.companyId, stato: { in: ['FAILED', 'RETRY'] } } }),
    prisma.feeAddebito.count({ where: { agenziaId: u.companyId, stato: 'IN_LAVORAZIONE' } }),
  ]);

  // "in elaborazione" = nessun fee ritentabile ma uno o più in volo (retry processing)
  const inElaborazione = scoperti === 0 && inVolo > 0;

  return (
    <BloccoPagamentoClient
      ibanAttuale={agenzia.iban ?? ''}
      motivo={agenzia.bloccoPagamentoMotivo ?? null}
      inElaborazione={inElaborazione}
    />
  );
}
