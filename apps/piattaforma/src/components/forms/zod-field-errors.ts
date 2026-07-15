import type { z } from 'zod';

export type FieldErrorsMap = Record<string, string | undefined>;

/**
 * Valida `values` con `schema` e restituisce una mappa campo→messaggio.
 * Prende la PRIMA issue per ciascun `path[0]` (i messaggi vengono dagli schemi
 * Zod condivisi, così client e server dicono la stessa cosa). Funzione pura.
 */
export function zodFieldErrors(
  schema: z.ZodTypeAny,
  values: unknown,
): Record<string, string> {
  const res = schema.safeParse(values);
  if (res.success) return {};
  const out: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !(key in out)) out[key] = issue.message;
  }
  return out;
}

/** True se almeno un campo ha un messaggio (usata per gatare il submit). */
export function hasBlockingErrors(errors: FieldErrorsMap): boolean {
  return Object.values(errors).some(Boolean);
}
