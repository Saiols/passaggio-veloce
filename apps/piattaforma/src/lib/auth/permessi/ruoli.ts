import type { SedeRole } from '@/lib/sedi/scope';

/**
 * Etichette dei ruoli mostrate all'utente. FONTE UNICA: prima erano sparse in
 * sei punti con parole discordanti ("Admin piattaforma" nella sidebar admin,
 * "Admin"/"Utente" nella pagina Team, "Admin di sede"/"Operatore" nei form di
 * invito), e nessuna era riusabile.
 *
 * Il vocabolario riusa le parole già presenti nel Team ("Admin di sede",
 * "Operatore"). Il proprietario è "Titolare" e non "Admin" perché quest'ultimo
 * si confonde con l'admin di piattaforma.
 */
export type RuoloVisualizzato =
  | 'Titolare'
  | 'Admin di sede'
  | 'Operatore'
  | 'Admin piattaforma'
  | 'Assistente'
  | 'Staff';

/**
 * Il ruolo con cui l'utente sta operando ORA.
 *
 * Attenzione: per i non-owner `User.role` è sempre `UTENTE_AZIENDA` e NON dice
 * nulla — il ruolo utile sta nella membership della sede corrente
 * (`UserSede.ruolo`), già risolta da `resolveSedeRole()`. La stessa persona può
 * essere admin in una sede e operatore in un'altra: l'etichetta segue la sede
 * selezionata, non l'utente in astratto.
 */
export function etichettaRuolo(args: {
  role: string | undefined;
  sedeRole: SedeRole;
}): RuoloVisualizzato {
  const { role, sedeRole } = args;

  // Lo staff di piattaforma non ha sedi: si decide sul solo User.role.
  if (role === 'ADMIN_PIATTAFORMA') return 'Admin piattaforma';
  if (role === 'ASSISTENTE') return 'Assistente';
  if (role === 'AD' || role === 'CTO' || role === 'CFO' || role === 'SALES_MANAGER' || role === 'SALES') {
    return 'Staff';
  }

  // Azienda: il proprietario resta Titolare anche in vista aggregata, dove non
  // esiste una sede corrente su cui calcolare un ruolo di membership.
  if (role === 'ADMIN_AZIENDA' || sedeRole === 'OWNER') return 'Titolare';

  if (sedeRole === 'ADMIN_SEDE') return 'Admin di sede';

  // OPERATORE, oppure nessuna sede accessibile / ruolo sconosciuto: il livello
  // minimo. Mai stringa vuota: una card senza ruolo sembrerebbe un bug.
  return 'Operatore';
}
