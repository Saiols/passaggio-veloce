/**
 * Query condivisa per individuare gli User che possono autenticarsi con
 * credenziali per una data email.
 *
 * Usata sia dal pre-check in `loginAction` (decide se serve il 2FA) sia da
 * `authorize` in auth.ts (fonte autoritativa). Estratta qui per evitare che le
 * due query divergano: il filtro `where` deve restare identico.
 *
 * Email univoca su tutta la piattaforma (spec 2026-07-25): al più un record
 * può combaciare, quindi nessun `orderBy`/tie-break è necessario — entrambi i
 * chiamanti usano `findFirst`.
 *
 * Gate verifica email: accettiamo SOLO `status: 'ACTIVE'`. Un account
 * `PENDING_EMAIL_VERIFICATION` (registrato ma email non ancora confermata) o
 * `SUSPENDED` NON può accedere. `loginAction` intercetta a parte il caso
 * PENDING con password corretta per mostrare un messaggio dedicato + reinvio
 * del link, invece del generico "credenziali non valide".
 *
 * Ogni chiamante aggiunge il proprio `select`/`include`.
 */
export function activeUserCredentialsQuery(emailLower: string) {
  return {
    where: {
      email: emailLower,
      deletedAt: null,
      status: 'ACTIVE' as const,
    },
  };
}
