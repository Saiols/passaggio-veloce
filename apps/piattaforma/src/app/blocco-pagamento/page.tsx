import { redirect } from 'next/navigation';
import { prisma } from '@pv/db';
import { auth } from '@/auth';
import { isOwner } from '@/lib/auth/permissions';
import { SuspensionBanner } from '@/components/suspension-banner';
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

  // Solo il titolare può cambiare l'IBAN: a chi non può, non lo mandiamo nemmeno
  // nel payload della pagina.
  const titolare = isOwner(u.role);

  return (
    <>
      {/* Questa pagina NON passa da AppShell (è un interstiziale senza chrome),
          quindi il banner globale montato là non la copre — e proprio qui finisce
          chi è sospeso E bloccato per addebito: `redirectSeAgenziaBloccata()`
          manda in questo punto da /dashboard, /pratiche e /inbox, cioè dai tre
          ancoraggi dove il banner si leggerebbe. Senza questo montaggio, l'unica
          sospensione di cui la pagina parla è quella per il pagamento, e il
          rifiuto di "Aggiorna IBAN" (ora BLOCCA) resterebbe inspiegato.
          `empty:hidden`: nessuno spazio residuo quando il banner si annulla. */}
      <div className="mx-auto max-w-xl px-4 pt-10 empty:hidden">
        <SuspensionBanner />
      </div>
      <BloccoPagamentoClient
        isOwner={titolare}
        ibanAttuale={titolare ? (agenzia.iban ?? '') : ''}
        motivo={agenzia.bloccoPagamentoMotivo ?? null}
        inElaborazione={inElaborazione}
      />
    </>
  );
}
