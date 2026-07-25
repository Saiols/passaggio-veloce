import { dipendenzaDi, isPermesso, permessiPerTipo, type CompanyTypeP, type Permesso } from './catalogo';
import { isLettura } from './sola-lettura';
import { preset } from './preset';
import type { Role } from '@/lib/auth/permissions';

export type PermessiCtx = {
  userId: string;
  isOwner: boolean;
  permessi: Set<Permesso>;
  /**
   * Utente o azienda sospesi: sopravvivono solo le chiavi di lettura.
   * Obbligatorio: un campo opzionale può essere dimenticato da un adattatore
   * locale (è già successo — un titolare sospeso passava comunque i gate del
   * modulo team). L'unico modo lecito di costruire un `PermessiCtx` in
   * produzione è `toPermessiCtx()` in `./guard`, che lo popola sempre da
   * `SessionContext.sospensione`.
   */
  soloLettura: boolean;
};

/**
 * Owner: sempre vero. Altrimenti la chiave dev'essere nel set E nel catalogo.
 * Il secondo controllo non è ridondante: difende dalle righe vecchie del DB, in
 * cui può essere rimasta una chiave che il catalogo non conosce più.
 *
 * La sola lettura si valuta PRIMA dello short-circuit sull'owner: nella maggior
 * parte delle aziende clienti l'ADMIN_AZIENDA è l'UNICA utenza, quindi esentarlo
 * lascerebbe la sospensione senza effetto nel caso più comune.
 */
export function can(ctx: PermessiCtx, p: Permesso): boolean {
  if (ctx.soloLettura && !isLettura(p)) return false;
  if (ctx.isOwner) return true;
  return isPermesso(p) && ctx.permessi.has(p);
}

/** Ciò che il chiamante può concedere: tutto se owner, altrimenti esattamente i propri. */
export function assignablePermessi(ctx: PermessiCtx, t: CompanyTypeP): Permesso[] {
  const tutti = permessiPerTipo(t);
  if (ctx.isOwner) return tutti;
  return tutti.filter((p) => ctx.permessi.has(p));
}

export type ValidaResult = { ok: true; permessi: Permesso[] } | { ok: false; error: string };

/** Creazione: non c'è ancora un utente target, niente ruolo da proteggere. */
type SenzaTarget = { targetUserId?: undefined; targetRole?: undefined };
/**
 * Modifica di un utente ESISTENTE: il ruolo del target è obbligatorio a
 * livello di tipo, non solo di commento. Senza `targetRole` la protezione
 * dell'owner non potrebbe scattare — un chiamante che passa `targetUserId` e
 * dimentica `targetRole` non compila più, non ottiene silenziosamente
 * `{ok: true}`. Il chiamante lo ricava dalla riga del DB (campo `role`
 * dell'utente target), non da input dell'utente.
 */
type ConTarget = { targetUserId: string; targetRole: Role };

/**
 * Le quattro regole anti-escalation. Rifiuta con errore, non filtra in silenzio:
 * una chiave non assegnabile è un tentativo di escalation, non un refuso.
 */
export function validaPermessi(
  args: { ctx: PermessiCtx; companyType: CompanyTypeP; richiesti: string[] } & (SenzaTarget | ConTarget),
): ValidaResult {
  const { ctx, companyType, richiesti, targetUserId, targetRole } = args;

  if (targetRole === 'ADMIN_AZIENDA') {
    return { ok: false, error: 'Non puoi modificare i permessi del titolare' };
  }
  if (targetUserId !== undefined && targetUserId === ctx.userId) {
    return { ok: false, error: 'Non puoi modificare i tuoi permessi' };
  }
  if (!can(ctx, 'team.permessi')) {
    return { ok: false, error: 'Non hai il permesso di assegnare permessi ad altri' };
  }

  const validi = new Set<Permesso>(permessiPerTipo(companyType));
  const assegnabili = new Set<Permesso>(assignablePermessi(ctx, companyType));
  const set = [...new Set(richiesti)].sort();

  // `richiesti` arriva da un form: è `string[]`. `isPermesso` lo restringe.
  const puliti: Permesso[] = [];
  for (const p of set) {
    if (!isPermesso(p)) return { ok: false, error: `Permesso sconosciuto: ${p}` };
    if (!validi.has(p)) return { ok: false, error: `Permesso non valido per questa azienda: ${p}` };
    if (!assegnabili.has(p)) {
      return { ok: false, error: `Non puoi concedere un permesso che non hai: ${p}` };
    }
    puliti.push(p);
  }
  for (const p of puliti) {
    const dip = dipendenzaDi(p);
    if (dip && !puliti.includes(dip)) {
      return { ok: false, error: `Il permesso ${p} richiede ${dip}` };
    }
  }
  return { ok: true, permessi: puliti };
}

/**
 * Rimuove dal set i permessi la cui dipendenza è saltata via, iterando finché
 * un giro non cambia più nulla: in una catena a più livelli togliere un
 * padre può orfanare un nipote due passi sotto, quindi un solo passaggio non
 * basta. (Il catalogo attuale non ha più nessuna catena a tre livelli — l'unica,
 * `sede.view` → `sede.edit` → `sede.iban`, è sparita con la rimozione di
 * `sede.iban` — ma la funzione resta generale.)
 */
function potaOrfani(permessi: Permesso[]): Permesso[] {
  const set = new Set(permessi);
  let cambiato = true;
  while (cambiato) {
    cambiato = false;
    for (const p of set) {
      const dip = dipendenzaDi(p);
      if (dip && !set.has(dip)) {
        set.delete(p);
        cambiato = true;
      }
    }
  }
  return [...set];
}

/**
 * Permessi da assegnare a un utente in creazione.
 * Chi non ha `team.permessi` non sceglie: riceve il preset base intersecato
 * ai permessi del chiamante (non si concede ciò che non si ha).
 *
 * Il chiamante può avere già un set incoerente (es. `pratiche.download` senza
 * `pratiche.view`, riga vecchia del DB): l'intersezione da sola può lasciare
 * nel risultato un figlio senza il suo padre. Qui si pota in silenzio — non è
 * una richiesta esplicita da rifiutare, è un calcolo automatico che deve
 * comunque restare un set valido per `validaPermessi`.
 */
export function permessiPerNuovoUtente(
  ctx: PermessiCtx,
  companyType: CompanyTypeP,
  richiesti?: string[],
): ValidaResult {
  if (!can(ctx, 'team.permessi') || richiesti === undefined) {
    const assegnabili = new Set(assignablePermessi(ctx, companyType));
    const base = potaOrfani(preset('OPERATORE_BASE', companyType).filter((p) => assegnabili.has(p)));
    return { ok: true, permessi: base.sort() };
  }
  return validaPermessi({ ctx, companyType, richiesti });
}
