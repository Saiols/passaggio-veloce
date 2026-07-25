/**
 * Stato di sospensione di un utente azienda, calcolato dalle righe DB.
 * Modulo PURO: nessun import di sessione o Prisma, così `session-context.ts`
 * può importarlo senza creare un ciclo. Gli accessori async stanno in
 * ./sospensione-guard.ts.
 *
 * Spec: docs/superpowers/specs/2026-07-25-sospensione-sola-lettura-design.md
 */

export type OrigineSospensione = 'UTENTE' | 'AZIENDA';

export type StatoSospensione =
  | { sospeso: false; motivo: null; origine: null }
  | { sospeso: true; motivo: string | null; origine: OrigineSospensione };

export const NON_SOSPESO: StatoSospensione = { sospeso: false, motivo: null, origine: null };

/**
 * Messaggio unico mostrato quando un'operazione viene rifiutata per
 * sospensione. Non è il generico «Non hai i permessi»: l'utente i permessi li
 * ha, gli è stata sospesa l'operatività — dirgli la cosa sbagliata lo manderebbe
 * a cercare un problema che non esiste.
 */
export const ERRORE_SOSPENSIONE =
  'Il tuo account è sospeso: puoi consultare i tuoi dati ma non svolgere operazioni. Il motivo è indicato nell\'email che hai ricevuto.';

/**
 * `SUSPENDED` sull'utente OPPURE `suspendedAt` sull'azienda.
 *
 * La misura aziendale prevale su quella individuale: è la più ampia, e il suo
 * motivo è quello che l'utente ha ricevuto per email (N14).
 * `suspendCompanyAction` porta a `SUSPENDED` anche gli utenti ma scrive la nota
 * solo sulla company, quindi leggere la nota utente in quel caso darebbe il
 * testo sbagliato (o nessun testo).
 *
 * `PENDING_EMAIL_VERIFICATION` NON è una sospensione: ha il suo gate al login.
 */
export function calcolaSospensione(input: {
  // Union letterale locale (il modulo resta puro, niente import di Prisma):
  // con `string` un domani rinominasse il membro dell'enum, il confronto
  // `=== 'SUSPENDED'` diventerebbe silenziosamente sempre falso — fail-OPEN
  // su un controllo di sicurezza. Così il compilatore lo segnala.
  userStatus: 'ACTIVE' | 'SUSPENDED' | 'PENDING_EMAIL_VERIFICATION' | undefined;
  userNote: string | null | undefined;
  companySuspendedAt: Date | null | undefined;
  companyNote: string | null | undefined;
}): StatoSospensione {
  if (input.companySuspendedAt) {
    return { sospeso: true, motivo: input.companyNote ?? null, origine: 'AZIENDA' };
  }
  if (input.userStatus === 'SUSPENDED') {
    return { sospeso: true, motivo: input.userNote ?? null, origine: 'UTENTE' };
  }
  return NON_SOSPESO;
}
