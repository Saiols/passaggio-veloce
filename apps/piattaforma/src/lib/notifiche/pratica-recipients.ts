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

/**
 * Quanto si allarga il primo livello, deciso dal LATO della pratica — non dal
 * ruolo di chi ha operato:
 *
 * - `tutta-la-sede` (broker): la pratica è del punto vendita, non della persona.
 *   Chi l'ha creata e i colleghi della sua sede seguono tutti la stessa
 *   pratica, quindi ricevono tutti. Se il cliente richiama e chi l'ha inserita
 *   è in ferie, chiunque in sede sa a che punto è.
 * - `chi-opera` (agenzia): la prende in carico una persona e la porta avanti
 *   lei; solo il super admin, che opera *da* una filiale, porta con sé la sede
 *   per non lasciarla all'oscuro.
 */
export type Ampiezza = 'tutta-la-sede' | 'chi-opera';

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
 * L'`ampiezza` del primo livello dipende dal lato (vedi il tipo): lato broker
 * ricevono sempre anche i colleghi di sede, lato agenzia solo chi ha preso in
 * carico — a meno che sia il super admin, che porta con sé la filiale da cui ha
 * operato. `isOwner` è il ruolo di piattaforma `ADMIN_AZIENDA`, non
 * `UserSede.ruolo`: un `ADMIN_SEDE` è admin della filiale, non dell'azienda.
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
  ampiezza: Ampiezza;
}): Destinatario[] {
  if (args.preferito) {
    const allarga = args.ampiezza === 'tutta-la-sede' || args.preferito.isOwner;
    const primoLivello = allarga
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
