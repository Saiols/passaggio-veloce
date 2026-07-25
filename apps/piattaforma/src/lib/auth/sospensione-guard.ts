import 'server-only';
import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth/session-context';
import { ERRORE_SOSPENSIONE, NON_SOSPESO, type StatoSospensione } from '@/lib/auth/sospensione';

/**
 * Stato di sospensione dell'utente corrente. Nessuna query aggiuntiva: legge
 * il contesto, che è già `cache()`-ato per richiesta.
 */
export async function statoSospensione(): Promise<StatoSospensione> {
  const ctx = await getSessionContext();
  return ctx?.sospensione ?? NON_SOSPESO;
}

/**
 * Gate per le server action che NON sono protette da una chiave del catalogo
 * (quelle a permesso `null` in mappa-enforcement.ts): l'intersezione dei
 * permessi non le intercetta, serve il controllo esplicito.
 */
export async function requireOperativita(): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await statoSospensione();
  if (!s.sospeso) return { ok: true };
  return { ok: false, error: ERRORE_SOSPENSIONE };
}

/** Gate per le pagine di sola modifica: rimanda alla dashboard, dove il banner spiega. */
export async function assertOperativita(): Promise<void> {
  const s = await statoSospensione();
  if (s.sospeso) redirect('/dashboard');
}
