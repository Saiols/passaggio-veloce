/**
 * Chi riceve le email del ciclo di vita di una pratica — logica pura, niente IO.
 * L'orchestratore che carica i candidati dal DB è `pratica.ts` (stesso rapporto
 * fra `cliente-recipients.ts` e `cliente.ts`).
 *
 * Le email del ciclo di vita nascono per azienda ma vengono lavorate da una
 * SEDE: il destinatario giusto è chi ha in mano la pratica. Quando quella
 * persona non è raggiungibile si scende di livello — mai si annulla l'invio.
 */

/**
 * Un candidato al recapito.
 *
 * `isOwner` è il ruolo di PIATTAFORMA `ADMIN_AZIENDA` (il titolare), **non**
 * `UserSede.ruolo`: un `ADMIN_SEDE` è admin della filiale, non dell'azienda, e
 * qui vale come operatore. Stessa definizione di `lib/auth/permissions.ts#isOwner`.
 *
 * Esce dal risolutore perché decide due cose diverse: **chi** entra nella lista
 * (sotto) e **cosa vede** — la N4 mostra il saldo del wallet aziendale solo al
 * titolare.
 */
export type Destinatario = {
  email: string;
  userId: string | null;
  nome: string;
  isOwner: boolean;
};

/**
 * Quanto si allarga il primo livello, deciso dal LATO della pratica — non dal
 * ruolo di chi ha operato:
 *
 * - `operatori-della-sede` (broker): la pratica è del punto vendita, non della
 *   persona. Chi l'ha lavorata e i colleghi **operativi** della sua sede
 *   ricevono tutti: se il cliente richiama e chi l'ha inserita è in ferie,
 *   chiunque in sede sa a che punto è. Il **titolare** invece entra solo se è
 *   lui ad averla lavorata — non deve trovarsi in casella la posta dei suoi
 *   operatori, con il loro nome in testa.
 * - `chi-opera` (agenzia): la prende in carico una persona e la porta avanti
 *   lei; solo il titolare, che opera *da* una filiale, porta con sé la sede per
 *   non lasciarla all'oscuro.
 */
export type Ampiezza = 'operatori-della-sede' | 'chi-opera';

/** Un indirizzo è utilizzabile solo se, ripulito, non è vuoto. */
function emailValida(email: string): boolean {
  return email.trim().length > 0;
}

/** Deduplica per email normalizzata (trim + lowercase), preservando l'ordine. */
function dedup(candidati: Destinatario[]): Destinatario[] {
  const visti = new Set<string>();
  const out: Destinatario[] = [];
  for (const c of candidati) {
    if (!emailValida(c.email)) continue;
    const chiave = c.email.trim().toLowerCase();
    if (visti.has(chiave)) continue;
    visti.add(chiave);
    out.push(c);
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
 * L'`ampiezza` del primo livello dipende dal lato (vedi il tipo). Lato broker i
 * livelli di sede contengono i soli **operatori**: il titolare ne esce, sia come
 * collega di chi ha lavorato la pratica sia da solo. Non sparisce però dalla
 * catena — resta il livello `adminAzienda`, quindi una sede fatta del solo
 * titolare continua a ricevere e nessuna notifica va persa.
 *
 * La N6 "nuova pratica assegnata" parte prima che qualcuno prenda in carico la
 * pratica: passa `preferito: null` e ricade sui membri della sede. Non serve un
 * secondo risolutore.
 */
export function destinatariPratica(args: {
  preferito: Destinatario | null;
  membriSede: Destinatario[];
  adminAzienda: Destinatario | null;
  emailAzienda: string | null;
  ragioneSociale: string;
  ampiezza: Ampiezza;
}): Destinatario[] {
  // Lato broker il titolare entra solo dalla porta del preferito: come membro
  // della sede riceverebbe la posta indirizzata ai suoi operatori.
  const colleghi =
    args.ampiezza === 'operatori-della-sede'
      ? args.membriSede.filter((m) => !m.isOwner)
      : args.membriSede;

  if (args.preferito) {
    const allarga = args.ampiezza === 'operatori-della-sede' || args.preferito.isOwner;
    const primoLivello = allarga ? [args.preferito, ...colleghi] : [args.preferito];
    const p = dedup(primoLivello);
    if (p.length > 0) return p;
  }

  const membri = dedup(colleghi);
  if (membri.length > 0) return membri;

  if (args.adminAzienda) {
    const a = dedup([args.adminAzienda]);
    if (a.length > 0) return a;
  }

  // Ultimo indirizzo rimasto: quello registrato dall'azienda. È il recapito
  // dell'entità legale, quindi vale come titolare (è la casella su cui la N4
  // ripiegava già prima di passare dal risolutore).
  const azienda = args.emailAzienda?.trim();
  if (azienda) return [{ email: azienda, userId: null, nome: args.ragioneSociale, isOwner: true }];

  return [];
}
