import { auth } from '@/auth';
import { tierForRole, type Tier } from './tier';

/**
 * Risolve il tier dalla sessione autenticata. SEMPRE lato server, mai dal
 * client. Su qualsiasi errore → 'public' (fail-safe verso il meno privilegiato).
 */
export async function resolveTier(): Promise<Tier> {
  try {
    const session = await auth();
    return tierForRole(session?.user?.role);
  } catch {
    return 'public';
  }
}
