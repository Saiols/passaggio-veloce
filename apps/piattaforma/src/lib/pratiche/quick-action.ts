/**
 * Esito delle quick-action usate dalla lista pratiche (nessuna navigazione).
 *
 * Vive qui — non in `app/pratiche/actions.ts` — perché `firma-engine.ts` lo
 * consuma: `actions.ts` ha `'use server'`, e un `import type` da lì oggi è
 * innocuo (cancellato a compile time) ma diventerebbe un ciclo a runtime se
 * qualcuno togliesse `type`. Un modulo di soli tipi non ha questo problema.
 */
export type QuickActionResult = { ok: true } | { ok: false; error: string };
