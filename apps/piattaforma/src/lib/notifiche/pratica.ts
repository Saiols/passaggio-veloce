import 'server-only';
import { prisma } from '@pv/db';
import { destinatariPratica, type Ampiezza, type Destinatario } from './pratica-recipients';

/**
 * Chi riceve le email del ciclo di vita di una pratica: carica i candidati dal
 * DB e delega la scelta al risolutore puro `pratica-recipients.ts`.
 *
 * Le email amministrative (addebito, fattura, credito wallet, penale) NON
 * passano di qui: restano all'admin dell'azienda madre, perché IBAN, fatture e
 * blocchi di pagamento riguardano l'entità legale, non chi lavora la pratica.
 */

const SELECT_UTENTE = { id: true, email: true, nome: true, role: true } as const;

type UtenteDb = { id: string; email: string; nome: string | null; role: string };

/**
 * `isOwner` è il ruolo di PIATTAFORMA, non `UserSede.ruolo`: un `ADMIN_SEDE` è
 * admin della filiale, non dell'azienda. Stessa definizione di
 * `lib/auth/permissions.ts#isOwner`. Lo porta OGNI candidato, non solo il
 * preferito: lato broker è il ruolo dei membri di sede a decidere chi entra.
 */
function toDestinatario(u: UtenteDb, fallbackNome: string): Destinatario {
  return {
    email: u.email,
    userId: u.id,
    nome: u.nome?.trim() || fallbackNome,
    isOwner: u.role === 'ADMIN_AZIENDA',
  };
}

/**
 * L'utente "preferito" (creatore o accettante) conta solo se è ancora
 * raggiungibile: se è uscito dall'azienda o è sospeso non lo si trova, e la
 * catena scende da sola al livello successivo.
 */
async function preferitoAttivo(userId: string | null): Promise<UtenteDb | null> {
  if (!userId) return null;
  return prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', deletedAt: null },
    select: SELECT_UTENTE,
  });
}

async function membriDellaSede(sedeId: string | null): Promise<UtenteDb[]> {
  if (!sedeId) return [];
  const righe = await prisma.userSede.findMany({
    where: { sedeId, user: { status: 'ACTIVE', deletedAt: null } },
    select: { user: { select: SELECT_UTENTE } },
    orderBy: { createdAt: 'asc' },
  });
  return righe.map((r) => r.user);
}

async function adminDellAzienda(companyId: string): Promise<UtenteDb | null> {
  return prisma.user.findFirst({
    where: { companyId, role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
    select: SELECT_UTENTE,
  });
}

/**
 * Risolve la catena completa per una company, con o senza utente preferito.
 * `ampiezza` è obbligatoria: ogni lato deve dichiarare se la pratica è della
 * persona o della sede, invece di ereditare un default silenzioso.
 */
async function risolvi(args: {
  preferitoUserId: string | null;
  sedeId: string | null;
  companyId: string;
  ampiezza: Ampiezza;
}): Promise<Destinatario[]> {
  const azienda = await prisma.company.findUnique({
    where: { id: args.companyId },
    select: { email: true, ragioneSociale: true },
  });
  if (!azienda) return [];

  const [preferito, membri, admin] = await Promise.all([
    preferitoAttivo(args.preferitoUserId),
    membriDellaSede(args.sedeId),
    adminDellAzienda(args.companyId),
  ]);

  return destinatariPratica({
    preferito: preferito ? toDestinatario(preferito, azienda.ragioneSociale) : null,
    membriSede: membri.map((m) => toDestinatario(m, azienda.ragioneSociale)),
    adminAzienda: admin ? toDestinatario(admin, azienda.ragioneSociale) : null,
    emailAzienda: azienda.email,
    ragioneSociale: azienda.ragioneSociale,
    ampiezza: args.ampiezza,
  });
}

/**
 * Destinatari lato broker: chi ha creato la pratica **e gli operatori della
 * sede da cui l'ha creata**. La sede è `brokerSedeId`, cioè quella scelta nel
 * selettore "Sede di partenza" del wizard, quindi il giro resta la filiale con
 * cui si è davvero operato e non tutta l'azienda.
 *
 * Il titolare (`ADMIN_AZIENDA`) riceve **solo se ha lavorato lui la pratica**:
 * la posta di un operatore non finisce nella casella del capo. Se la sede non
 * ha operatori raggiungibili la catena scende e il titolare la riprende come
 * ultimo livello, così nessuna notifica va persa.
 */
export async function destinatariBroker(praticaId: string): Promise<Destinatario[]> {
  const p = await prisma.pratica.findUnique({
    where: { id: praticaId },
    select: { creatoDaUserId: true, brokerSedeId: true, brokerId: true },
  });
  if (!p) return [];
  return risolvi({
    preferitoUserId: p.creatoDaUserId,
    sedeId: p.brokerSedeId,
    companyId: p.brokerId,
    ampiezza: 'operatori-della-sede',
  });
}

/**
 * Destinatari lato agenzia DOPO l'accettazione: chi l'ha accettata, poi la sede
 * assegnataria. L'assegnazione manuale dell'admin porta la pratica in ACCETTATA
 * senza che nessuno in agenzia accetti: lì `accettataDaUserId` resta null e si
 * ricade — correttamente — sui membri della sede.
 */
export async function destinatariAgenzia(praticaId: string): Promise<Destinatario[]> {
  const p = await prisma.pratica.findUnique({
    where: { id: praticaId },
    select: { accettataDaUserId: true, agenziaSedeId: true, agenziaAssegnataId: true },
  });
  if (!p?.agenziaAssegnataId) return [];
  return risolvi({
    preferitoUserId: p.accettataDaUserId,
    sedeId: p.agenziaSedeId,
    companyId: p.agenziaAssegnataId,
    ampiezza: 'chi-opera',
  });
}

/**
 * Destinatari di una SEDE agenzia PRIMA dell'accettazione (N6 "nuova pratica
 * assegnata"): nessuno l'ha ancora presa in carico, quindi nessun preferito.
 */
export async function destinatariSedeAgenzia(sedeId: string): Promise<Destinatario[]> {
  const sede = await prisma.sede.findUnique({
    where: { id: sedeId },
    select: { companyId: true },
  });
  if (!sede) return [];
  // Senza preferito l'ampiezza non è in gioco: si parte già dai membri della sede.
  return risolvi({
    preferitoUserId: null,
    sedeId,
    companyId: sede.companyId,
    ampiezza: 'chi-opera',
  });
}
