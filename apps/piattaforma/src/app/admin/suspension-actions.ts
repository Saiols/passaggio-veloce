'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminOrAssistente, isAdminPiattaforma } from '@/lib/auth/permissions';
import { sendNotification } from '@/lib/notifiche';
import { eseguiPayoutImmediato, settlePayout, type EseguiPayoutResult } from '@/lib/wallet/payout-exec';
import { hasNegativeCompanyWallet } from '@/lib/wallet/negative-wallet-guard';

/**
 * Helper: invia notifica lifecycle a tutti gli utenti attivi di una company,
 * best-effort (errori provider non bloccano l'azione admin). Item 17 release
 * 2026-05.
 */
async function notifyCompanyLifecycle(
  companyId: string,
  tipo: 'N14_ACCOUNT_SOSPESO' | 'N15_ACCOUNT_RIATTIVATO' | 'N16_ACCOUNT_ELIMINATO',
  motivo?: string | null,
): Promise<void> {
  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        ragioneSociale: true,
        users: {
          where: { deletedAt: null },
          select: { id: true, email: true, nome: true },
        },
      },
    });
    if (!company) return;
    for (const u of company.users) {
      if (tipo === 'N14_ACCOUNT_SOSPESO') {
        await sendNotification({
          tipo,
          target: { email: u.email, userId: u.id, companyId: company.id },
          payload: {
            nomeUtente: u.nome,
            ragioneSociale: company.ragioneSociale,
            motivo: motivo ?? null,
          },
        }).catch(() => undefined);
      } else if (tipo === 'N15_ACCOUNT_RIATTIVATO') {
        await sendNotification({
          tipo,
          target: { email: u.email, userId: u.id, companyId: company.id },
          payload: {
            nomeUtente: u.nome,
            ragioneSociale: company.ragioneSociale,
            motivo: motivo ?? null,
          },
        }).catch(() => undefined);
      } else {
        await sendNotification({
          tipo,
          target: { email: u.email, userId: u.id, companyId: company.id },
          payload: {
            nomeUtente: u.nome,
            ragioneSociale: company.ragioneSociale,
          },
        }).catch(() => undefined);
      }
    }
  } catch {
    // best-effort
  }
}

export type SuspensionResult = { ok: true } | { ok: false; error: string };

/**
 * F-01: sospende un singolo utente. Visibile a ADMIN_PIATTAFORMA + ASSISTENTE.
 * L'utente sospeso non può fare login (auth.ts esce a null su SUSPENDED).
 *
 * Clausola 12.3-bis dei Termini (quarta misura, distinta dalla sospensione
 * dell'intera azienda al punto 12.3): "la sospensione è comunicata via email
 * con indicazione del motivo" e "l'account aziendale e le altre utenze
 * dell'Utente restano pienamente operativi". Come `suspendCompanyAction`, il
 * motivo NON è opzionale: senza di esso il diritto di riesame previsto dalla
 * stessa clausola sarebbe svuotato. Rifiutata se vuoto dopo il trim.
 *
 * CRITICAL (review finale pre-merge): il target NON può essere il titolare
 * (ADMIN_AZIENDA). Nella maggior parte delle aziende clienti l'ADMIN_AZIENDA
 * è l'UNICA utenza (caso standard alla registrazione): sospenderlo
 * individualmente lascerebbe l'azienda senza alcun accesso mentre
 * `Company.suspendedAt` resta `null` — la sede continuerebbe a ricevere
 * assegnazioni (lib/distribuzione/tick.ts) senza che nessuno possa
 * rispondere, portando a 5 timeout e quindi all'auto-sospensione anti-abuso
 * (clausola 12.2) per un lockout causato da noi. La clausola 12.3-bis
 * promette invece che "l'account aziendale e le altre utenze restano
 * pienamente operativi": per il titolare l'unica misura individuale
 * disponibile è sospendere l'intero account (clausola 12.3).
 */
export async function suspendUserAction(
  userId: string,
  noteRaw: string | undefined,
): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Operazione riservata ad admin/assistente' };
  }
  if (userId === session.user.id) {
    return { ok: false, error: 'Non puoi sospendere te stesso' };
  }
  const note = sanitizeNote(noteRaw);
  if (!note) {
    return {
      ok: false,
      error:
        'Indica il motivo della sospensione: è obbligatorio (clausola 12.3-bis dei Termini) e viene incluso nell\'email inviata all\'utente.',
    };
  }

  // Una sola query: serve sia per il guard sul ruolo del target sia (se il
  // guard passa) per popolare l'email N45 — evita un secondo giro sul DB.
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, email: true, nome: true, companyId: true, company: { select: { ragioneSociale: true } } },
  });
  if (!target) {
    return { ok: false, error: 'Utente non trovato' };
  }
  if (target.role === 'ADMIN_AZIENDA') {
    return {
      ok: false,
      error:
        "Il titolare (ADMIN_AZIENDA) non è sospendibile singolarmente: per sospendere il titolare occorre sospendere l'intero account (clausola 12.3 dei Termini).",
    };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { status: 'SUSPENDED', suspensionLastNote: note },
  });

  // Email best-effort all'utente sospeso, con il motivo (clausola 12.3-bis).
  // L'account aziendale e le altre utenze NON sono toccati da questa azione:
  // il payload lo dichiara esplicitamente nel template N45.
  try {
    await sendNotification({
      tipo: 'N45_UTENTE_SOSPESO',
      target: { email: target.email, userId, companyId: target.companyId },
      payload: {
        nomeUtente: target.nome,
        ragioneSociale: target.company?.ragioneSociale ?? '—',
        motivo: note,
      },
    });
  } catch {
    // best-effort
  }

  revalidatePath('/admin/utenti');
  return { ok: true };
}

export async function reactivateUserAction(
  userId: string,
  noteRaw?: string,
): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Operazione riservata ad admin/assistente' };
  }
  const note = sanitizeNote(noteRaw);
  await prisma.user.update({
    where: { id: userId },
    data: { status: 'ACTIVE', suspensionLastNote: note },
  });
  revalidatePath('/admin/utenti');
  return { ok: true };
}

/**
 * F-01: sospende un'azienda intera (broker o agenzia). Setta suspendedAt
 * e sospende tutti i suoi utenti in cascata. Reversibile via reactivate.
 *
 * Clausola 12.3 dei Termini: "la sospensione è comunicata via email con
 * indicazione del motivo". Il motivo NON è più opzionale: senza di esso il
 * diritto di riesame previsto dalla stessa clausola sarebbe svuotato (l'utente
 * non saprebbe cosa contestare). Rifiutata se vuoto dopo il trim.
 */
export async function suspendCompanyAction(
  companyId: string,
  noteRaw: string | undefined,
): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Operazione riservata ad admin/assistente' };
  }
  const note = sanitizeNote(noteRaw);
  if (!note) {
    return {
      ok: false,
      error:
        'Indica il motivo della sospensione: è obbligatorio (clausola 12.3 dei Termini) e viene incluso nell\'email inviata all\'azienda.',
    };
  }
  await prisma.$transaction([
    prisma.company.update({
      where: { id: companyId },
      data: { suspendedAt: new Date(), suspensionLastNote: note },
    }),
    prisma.user.updateMany({
      where: { companyId },
      data: { status: 'SUSPENDED' },
    }),
  ]);
  await notifyCompanyLifecycle(companyId, 'N14_ACCOUNT_SOSPESO', note);
  revalidatePath('/admin/agenzie');
  revalidatePath('/admin/broker');
  revalidatePath('/admin/utenti');
  return { ok: true };
}

/**
 * MINOR non risolto (review finale pre-merge, ultima ondata — follow-up
 * deliberato, NON dimenticato): riattiva TUTTI gli utenti SUSPENDED della
 * company, incluso chi era stato sospeso individualmente da
 * `suspendUserAction` (clausola 12.3-bis) prima della sospensione aziendale
 * — la riattivazione dell'account revoca così, silenziosamente, anche una
 * sospensione individuale motivata e distinta.
 *
 * Una soluzione "pulita" richiederebbe una colonna esplicita che distingua
 * "sospeso dalla cascata aziendale" da "sospeso individualmente" (come
 * `Sede.suspensionOrigin` per le sedi) — non presente su `User` e valutata
 * eccessiva per questo giro (richiede migration). Un'euristica SENZA
 * migration — riattivare solo chi ha `suspensionLastNote: null` (il campo è
 * scritto solo da `suspendUserAction`/`reactivateUserAction`) — è stata
 * considerata e scartata: `reactivateUserAction` può lasciare una nota anche
 * su un utente tornato ACTIVE, quindi un utente MAI sospeso individualmente
 * ma con una nota residua da una vecchia riattivazione verrebbe erroneamente
 * escluso dalla riattivazione aziendale, restando bloccato — un lockout
 * silenzioso diverso ma non meno grave del bug originale. Follow-up:
 * aggiungere `User.suspensionSource` (enum, analogo a
 * `SedeSuspensionOrigin`) con relativa migration.
 */
export async function reactivateCompanyAction(
  companyId: string,
  noteRaw?: string,
): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Operazione riservata ad admin/assistente' };
  }
  const note = sanitizeNote(noteRaw);
  await prisma.$transaction([
    prisma.company.update({
      where: { id: companyId },
      data: { suspendedAt: null, suspensionLastNote: note },
    }),
    prisma.user.updateMany({
      where: { companyId, status: 'SUSPENDED' },
      data: { status: 'ACTIVE' },
    }),
  ]);
  await notifyCompanyLifecycle(companyId, 'N15_ACCOUNT_RIATTIVATO', note);
  revalidatePath('/admin/agenzie');
  revalidatePath('/admin/broker');
  revalidatePath('/admin/utenti');
  return { ok: true };
}

function sanitizeNote(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 1000);
}

/**
 * Eliminazione definitiva di una company (item 17 release 2026-05).
 * Soft delete immediato + notifica email. Hard delete dei dati personali
 * (documenti, recapiti) lascia agli script di retention a 90gg compliance
 * GDPR (job da implementare). Le pratiche storiche restano per audit
 * ma il riferimento alla company eliminata si renderizza come
 * "Account eliminato" lato UI (vedi fallback in /admin/pratiche).
 */
export async function deleteCompanyAction(
  companyId: string,
  confirmRagioneSociale: string,
): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return {
      ok: false,
      error: "Solo l'admin platform può eliminare definitivamente un account",
    };
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { ragioneSociale: true, deletedAt: true },
  });
  if (!company) return { ok: false, error: 'Azienda non trovata' };
  if (company.deletedAt) return { ok: false, error: 'Azienda già eliminata' };
  if (company.ragioneSociale.trim() !== confirmRagioneSociale.trim()) {
    return {
      ok: false,
      error: 'Conferma errata: digita esattamente la ragione sociale',
    };
  }

  // Notifica PRIMA del soft delete: dopo, gli user sono SUSPENDED e
  // l'invio resta valido perche' attinge da deletedAt: null al momento
  // della chiamata (il suspension non azzera deletedAt).
  await notifyCompanyLifecycle(companyId, 'N16_ACCOUNT_ELIMINATO');

  // Clausola 12.4 dei Termini: alla cessazione il saldo residuo è liquidato
  // integralmente, ANCHE se inferiore a 500 €, "previa... regolarizzazione di
  // quanto eventualmente dovuto a Passaggio Veloce". Se un wallet qualsiasi
  // dell'azienda (madre o di sede) è in saldo negativo — es. penale non
  // ripianata, clausola 10.6 — bonificare i wallet positivi e abbandonare il
  // debito violerebbe la clausola (IMPORTANT, review finale pre-merge: prima
  // di questo fix un'azienda con sede A a -25€ e sede B a +600€ incassava i
  // 600€ e il debito di 25€ semplicemente spariva).
  //
  // Scelta: BLOCCO della liquidazione automatica (non netting contabile fra
  // wallet). `eseguiPayoutImmediato` liquida un wallet per volta, per
  // l'intero saldo positivo: un vero netting (importo liquidato = Σ positivi
  // − |Σ negativi|) richiederebbe payout parziali su singolo wallet, non
  // supportati oggi, per un guadagno di automazione marginale a fronte di più
  // superficie per bug su un flusso di denaro reale. Se esiste un debito, i
  // wallet restano COSÌ COME SONO (nessun payout, nessuna scrittura): la
  // company viene comunque cancellata (soft delete, sotto), e la
  // regolarizzazione/liquidazione del residuo netto è gestita dall'admin
  // fuori da questo flusso best-effort. Se il debito assorbe per intero il
  // credito, correttamente non si bonifica nulla.
  try {
    const debito = await hasNegativeCompanyWallet(prisma, companyId);
    if (!debito) {
      // PRIMA di liquidare, salda le eventuali righe Payout RICHIESTO residue
      // di questa azienda (madre o di una sua sede). Non sono un caso raro:
      // sopravvivono al batch di `processPayouts` (oltre BATCH_SIZE), a un
      // run del cron fallito, o alla finestra fra i due cron (`trigger` alle
      // 01:00, `settlement` alle 01:30) — sulla copia locale di prod ne è
      // stata trovata una ferma da 12 giorni. Se nel frattempo l'azienda
      // viene sospesa, `processPayouts` la salta a ogni giro finché la
      // sospensione dura (guard corretto, lib/jobs/process-payouts.ts): e
      // un'azienda che stiamo per cancellare non verrà MAI più riattivata,
      // quindi quella riga resterebbe RICHIESTO in eterno.
      //
      // Alla cessazione (clausola 12.4 dei Termini: "il saldo residuo è
      // liquidato integralmente") saldarla qui è il comportamento corretto:
      // `ignoraSoglia`, poco sotto, stabilisce già che i blocchi da
      // sospensione/visura non si applicano a questo percorso, quindi non
      // stiamo aggirando nulla. Ed è ANCHE necessario: se la riga resta
      // RICHIESTO, il controllo anti-doppio-payout dentro la transazione di
      // reserve (`lib/wallet/payout-exec.ts`, righe ~269-273 — NON va reso
      // condizionale: impedisce di svuotare due volte lo stesso wallet) la
      // trova ancora in-flight e rifiuta l'INTERO wallet con "Payout già in
      // corso, attendi", bloccando anche la liquidazione del resto del
      // saldo.
      //
      // Riusiamo `settlePayout` — lo stesso motore di settlement usato da
      // `processPayouts` per queste identiche righe (nessuna
      // reimplementazione: IBAN, provider, transazione di saldo, documento
      // broker restano un unico posto) — con la stessa transizione a
      // IN_LAVORAZIONE prima di saldare (stesso "lock" morbido del job).
      // Dopo, il ciclo esistente sotto liquida il RESTO del saldo: il
      // settlement ha già decrementato il wallet dell'importo della riga
      // saldata, quindi ciò che rimane è il residuo vero.
      //
      // MAI le righe IN_LAVORAZIONE: significano un settlement DAVVERO in
      // corso (stesso motore, non un processo fantasma) — risaldarle
      // rischierebbe di pagare due volte. Il filtro sotto (`stato:
      // 'RICHIESTO'`) le esclude a priori: non vengono nemmeno lette, non
      // vengono toccate.
      const richiesteResidue = await prisma.payout.findMany({
        where: {
          stato: 'RICHIESTO',
          wallet: { OR: [{ companyId }, { sede: { companyId } }] },
        },
        select: { id: true, walletId: true },
      });
      for (const p of richiesteResidue) {
        try {
          await prisma.payout.update({
            where: { id: p.id },
            data: { stato: 'IN_LAVORAZIONE' },
          });
          const esito = await settlePayout(p.id);
          if (!esito.ok) {
            console.error(
              `[deleteCompanyAction] saldo riga RICHIESTO residua non riuscito (payoutId=${p.id}, walletId=${p.walletId}, company=${companyId}): ${esito.error}`,
            );
          }
        } catch (err) {
          console.error(
            `[deleteCompanyAction] saldo riga RICHIESTO residua: eccezione (payoutId=${p.id}, walletId=${p.walletId}, company=${companyId}):`,
            err,
          );
        }
      }

      const wallets = await prisma.wallet.findMany({
        where: {
          OR: [{ companyId }, { sede: { companyId } }],
          saldoCent: { gt: 0 },
        },
        select: { id: true },
      });
      for (const w of wallets) {
        // Best-effort per design (non deve bloccare la cancellazione), ma il
        // fallimento non può più sparire in silenzio: sia un'eccezione sia un
        // esito `{ ok: false }` (es. proprio "Payout già in corso" se il
        // saldo delle righe residue sopra fosse fallito) vengono loggati con
        // wallet ed errore, così restano diagnosticabili.
        const esito = await eseguiPayoutImmediato(w.id, { ignoraSoglia: true }).catch(
          (err): EseguiPayoutResult => {
            console.error(
              `[deleteCompanyAction] liquidazione cessazione: eccezione su wallet ${w.id} (company ${companyId}):`,
              err,
            );
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          },
        );
        if (!esito.ok) {
          console.error(
            `[deleteCompanyAction] liquidazione cessazione non riuscita per wallet ${w.id} (company ${companyId}): ${esito.error}`,
          );
        }
      }
    }
  } catch {
    // best-effort
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.company.update({
      where: { id: companyId },
      data: { suspendedAt: now, deletedAt: now },
    }),
    prisma.user.updateMany({
      where: { companyId, deletedAt: null },
      data: { status: 'SUSPENDED', deletedAt: now },
    }),
  ]);

  revalidatePath('/admin/agenzie');
  revalidatePath('/admin/broker');
  revalidatePath('/admin/utenti');
  return { ok: true };
}

/**
 * Revoca la sospensione anti-abuso di una SEDE (5 no-show consecutivi).
 * È l'unico modo per riattivarla: `setSedeSuspended` la rifiuta al titolare.
 * Cfr. clausola 12.2 dei Termini (revoca previa verifica di Passaggio Veloce).
 */
export async function reactivateSedeAntiAbusoAction(
  sedeId: string,
): Promise<SuspensionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminOrAssistente(session.user.role)) {
    return { ok: false, error: 'Operazione riservata ad admin/assistente' };
  }

  // Guardia: questa azione esiste SOLO per sciogliere la sanzione anti-abuso
  // (5 no-show consecutivi). Senza questo controllo riattiverebbe anche una
  // sede sospesa volontariamente dal titolare (es. per ferie/chiusura
  // stagionale, `suspensionOrigin: 'UTENTE'`) — non è una falla di sicurezza
  // (azione admin-only, la UI mostra il bottone solo per sedi ANTI_ABUSO), ma
  // scavalcherebbe una scelta organizzativa dell'utente per errore.
  const sede = await prisma.sede.findUnique({
    where: { id: sedeId },
    select: { suspensionOrigin: true },
  });
  if (!sede || sede.suspensionOrigin !== 'ANTI_ABUSO') {
    return { ok: false, error: 'Questa sede non risulta sospesa dal sistema anti-abuso' };
  }

  await prisma.sede.update({
    where: { id: sedeId, suspensionOrigin: 'ANTI_ABUSO' },
    data: { suspendedAt: null, suspensionOrigin: null },
  });

  revalidatePath('/admin/agenzie');
  revalidatePath('/sedi');
  return { ok: true };
}
