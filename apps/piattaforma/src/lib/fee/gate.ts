import 'server-only';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isAgenziaBloccata } from './blocco';

/**
 * Da chiamare in cima alle pagine operative dell'agenzia: se l'agenzia è
 * bloccata per addebito non riuscito, redirige alla pagina di rimedio.
 * No-op per ruoli non-agenzia o agenzie attive.
 */
export async function redirectSeAgenziaBloccata(): Promise<void> {
  const session = await auth();
  const u = session?.user;
  if (!u || u.companyType !== 'AGENZIA' || !u.companyId) return;
  if (await isAgenziaBloccata(u.companyId)) redirect('/blocco-pagamento');
}
