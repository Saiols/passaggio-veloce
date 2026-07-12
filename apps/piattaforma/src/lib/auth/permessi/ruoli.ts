import type { UserRole } from '@pv/db';
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
 * Etichetta dei ruoli di PIATTAFORMA: quelli che non dipendono dalla sede,
 * perché derivano solo da `User.role`. `null` = ruolo azienda (ADMIN_AZIENDA
 * o UTENTE_AZIENDA): per questi l'etichetta si calcola sempre dalla sede
 * (vedi `etichettaRuolo` sotto).
 *
 * `satisfies Record<UserRole, ...>` è la protezione reale: se domani si
 * aggiunge un valore a `UserRole` senza classificarlo qui, il TYPECHECK fallisce
 * (non un test che spera). Vedi ruoli.test.ts per la prova rosso→verde.
 */
const ETICHETTA_PER_RUOLO = {
  ADMIN_PIATTAFORMA: 'Admin piattaforma',
  ASSISTENTE: 'Assistente',
  AD: 'Staff',
  CTO: 'Staff',
  CFO: 'Staff',
  SALES_MANAGER: 'Staff',
  SALES: 'Staff',
  ADMIN_AZIENDA: null,
  UTENTE_AZIENDA: null,
} satisfies Record<UserRole, RuoloVisualizzato | null>;

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

  // Lo staff di piattaforma non ha sedi: si decide sul solo User.role. `role`
  // qui è una stringa qualunque (arriva dalla sessione, non tipizzata come
  // UserRole): un valore sconosciuto ("PIPPO", undefined) semplicemente non è
  // una chiave della mappa e cade nei rami azienda sotto.
  const etichettaPiattaforma =
    role !== undefined && Object.prototype.hasOwnProperty.call(ETICHETTA_PER_RUOLO, role)
      ? ETICHETTA_PER_RUOLO[role as UserRole]
      : null;
  if (etichettaPiattaforma) return etichettaPiattaforma;

  // Azienda: il proprietario resta Titolare anche in vista aggregata, dove non
  // esiste una sede corrente su cui calcolare un ruolo di membership.
  if (role === 'ADMIN_AZIENDA' || sedeRole === 'OWNER') return 'Titolare';

  if (sedeRole === 'ADMIN_SEDE') return 'Admin di sede';

  // OPERATORE, oppure nessuna sede accessibile / ruolo sconosciuto: il livello
  // minimo. Mai stringa vuota: una card senza ruolo sembrerebbe un bug.
  return 'Operatore';
}
