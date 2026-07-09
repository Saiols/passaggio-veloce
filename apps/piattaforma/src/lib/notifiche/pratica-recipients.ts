/**
 * Chi riceve le email del ciclo di vita di una pratica — logica pura, niente IO.
 * L'orchestratore che carica i candidati dal DB è `pratica.ts` (stesso rapporto
 * fra `cliente-recipients.ts` e `cliente.ts`).
 *
 * Le email del ciclo di vita nascono per azienda ma vengono lavorate da una
 * SEDE: il destinatario giusto è chi ha in mano la pratica. Quando quella
 * persona non è raggiungibile si scende di livello — mai si annulla l'invio.
 */

export type Destinatario = { email: string; userId: string | null; nome: string };

/** Il preferito porta con sé il ruolo: decide quanto si allarga il primo livello. */
export type Preferito = Destinatario & { isOwner: boolean };

/** Un indirizzo è utilizzabile solo se, ripulito, non è vuoto. */
function emailValida(email: string): boolean {
  return email.trim().length > 0;
}

/**
 * Deduplica per email normalizzata (trim + lowercase), preservando l'ordine, e
 * normalizza la forma: `isOwner` è un dettaglio del risolutore e non deve
 * uscirne.
 */
function dedup(candidati: Destinatario[]): Destinatario[] {
  const visti = new Set<string>();
  const out: Destinatario[] = [];
  for (const c of candidati) {
    if (!emailValida(c.email)) continue;
    const chiave = c.email.trim().toLowerCase();
    if (visti.has(chiave)) continue;
    visti.add(chiave);
    out.push({ email: c.email, userId: c.userId, nome: c.nome });
  }
  return out;
}

/**
 * Catena di fallback, vince il primo livello non vuoto:
 *
 *   preferito → membri della sede → admin azienda → email azienda → []
 *
 * `preferito` è il creatore (lato broker) o chi ha accettato (lato agenzia),
 * già filtrato ACTIVE e non cancellato dal chiamante: se è uscito dall'azienda
 * o è sospeso semplicemente non arriva qui, e la catena scende da sola.
 *
 * Chi ha operato decide l'ampiezza del primo livello. Un membro del team di
 * sede — admin di sede o operatore — segue lui quella pratica e la riceve da
 * solo. Il super admin, invece, opera *da* una filiale: se ricevesse solo lui,
 * quella filiale resterebbe all'oscuro di una pratica che dovrà proseguire.
 * Quindi con lui ricevono anche tutti i membri della sede su cui ha operato.
 * `isOwner` è il ruolo di piattaforma `ADMIN_AZIENDA`, non `UserSede.ruolo`.
 *
 * La N6 "nuova pratica assegnata" parte prima che qualcuno prenda in carico la
 * pratica: passa `preferito: null` e ricade sui membri della sede. Non serve un
 * secondo risolutore.
 */
export function destinatariPratica(args: {
  preferito: Preferito | null;
  membriSede: Destinatario[];
  adminAzienda: Destinatario | null;
  emailAzienda: string | null;
  ragioneSociale: string;
}): Destinatario[] {
  if (args.preferito) {
    // Il super admin porta con sé la sua filiale; chi è di sede resta solo.
    const primoLivello = args.preferito.isOwner
      ? [args.preferito as Destinatario, ...args.membriSede]
      : [args.preferito as Destinatario];
    const p = dedup(primoLivello);
    if (p.length > 0) return p;
  }

  const membri = dedup(args.membriSede);
  if (membri.length > 0) return membri;

  if (args.adminAzienda) {
    const a = dedup([args.adminAzienda]);
    if (a.length > 0) return a;
  }

  const azienda = args.emailAzienda?.trim();
  if (azienda) return [{ email: azienda, userId: null, nome: args.ragioneSociale }];

  return [];
}
