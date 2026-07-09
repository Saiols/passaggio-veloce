import 'server-only';
import { prisma } from '@pv/db';
import { destinatariPratica, type Destinatario, type Preferito } from './pratica-recipients';

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

function toDestinatario(u: UtenteDb, fallbackNome: string): Destinatario {
  return { email: u.email, userId: u.id, nome: u.nome?.trim() || fallbackNome };
}

/**
 * `isOwner` è il ruolo di PIATTAFORMA, non `UserSede.ruolo`: un `ADMIN_SEDE` è
 * admin della filiale, non dell'azienda. Stessa definizione di
 * `lib/auth/permissions.ts#isOwner`.
 */
function toPreferito(u: UtenteDb, fallbackNome: string): Preferito {
  return { ...toDestinatario(u, fallbackNome), isOwner: u.role === 'ADMIN_AZIENDA' };
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

/** Risolve la catena completa per una company, con o senza utente preferito. */
async function risolvi(args: {
  preferitoUserId: string | null;
  sedeId: string | null;
  companyId: string;
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
    preferito: preferito ? toPreferito(preferito, azienda.ragioneSociale) : null,
    membriSede: membri.map((m) => toDestinatario(m, azienda.ragioneSociale)),
    adminAzienda: admin ? toDestinatario(admin, azienda.ragioneSociale) : null,
    emailAzienda: azienda.email,
    ragioneSociale: azienda.ragioneSociale,
  });
}

/** Destinatari lato broker: chi ha creato la pratica, poi la sua sede. */
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
  return risolvi({ preferitoUserId: null, sedeId, companyId: sede.companyId });
}
