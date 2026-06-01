/**
 * Query condivisa per individuare gli User attivi associati a un'email durante
 * il login con credenziali.
 *
 * Usata sia dal pre-check in `loginAction` (decide se serve il 2FA) sia da
 * `authorize` in auth.ts (fonte autoritativa). Estratta qui per evitare che le
 * due query divergano: filtro `where` e `orderBy` devono restare identici.
 *
 * Ogni chiamante aggiunge il proprio `select`/`include`.
 */
export function activeUserCredentialsQuery(emailLower: string) {
  return {
    where: {
      email: emailLower,
      deletedAt: null,
      status: { not: 'SUSPENDED' as const },
    },
    orderBy: [{ companyId: 'asc' as const }, { createdAt: 'asc' as const }],
  };
}
