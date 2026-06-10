import { PUBLIC_KB, CLIENTS_KB, INTERNAL_KB } from './kb.generated';
import type { Tier } from './assemble';

/** Ritorna la knowledge base cumulativa per il tier richiesto. */
export function kbForTier(tier: Tier): string {
  if (tier === 'internal') return INTERNAL_KB;
  if (tier === 'clients') return CLIENTS_KB;
  return PUBLIC_KB;
}
