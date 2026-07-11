'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { getSessionContext } from '@/lib/auth/session-context';
import { toSedeScope, NO_SEDE_SCOPE } from '@/lib/sedi/scope-filters';
import { canAccessPratica } from '@/lib/pratiche/access';
import { requirePermesso } from '@/lib/auth/permessi/guard';
import { sendNotification, getAdminEmails, notifyClientiAvanzamento } from '@/lib/notifiche';
import { destinatariAgenzia } from '@/lib/notifiche/pratica';
import { emitEventiPratica } from '@/lib/eventi/emit';
import { eventoPraticaPenale } from '@/lib/eventi/pratica-eventi';
import { motivoPenaleSegnalazione } from '@/lib/pratiche/stato-extra';
import { walletBrokerDellaPratica } from '@/lib/wallet/wallet-pratica';
import { PENALI } from './config';

export type SegnalazioneTipo =
  | 'FERMO_AMMINISTRATIVO'
  | 'IPOTECA'
  | 'DOCUMENTO_NON_VALIDO'
  | 'ALTRO';

export type SegnalaPraticaResult = { ok: true } | { ok: false; error: string };

/**
 * L'agenzia assegnata segnala un problema sulla pratica accettata
 * (Sistema Penali Broker — SP-B). Spec: docs/sistema-penali-broker.md.
 *
 * Visibile solo in stati ACCETTATA o PROCESSATA (pre-firma). Dopo FIRMATA
 * non si può più segnalare via piattaforma.
 */
export async function segnalaPraticaAction(
  praticaId: string,
  tipo: SegnalazioneTipo,
  nota: string,
  veicoliIds: string[],
): Promise<SegnalaPraticaResult> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  // Autenticazione → permesso → scope: la segnalazione apre una penale di €25
  // a carico del broker, il gate va prima del controllo di scope sotto.
  const gate = await requirePermesso('pratiche.segnala');
  if (!gate.ok) return gate;

  if (session.user.companyType !== 'AGENZIA') {
    return { ok: false, error: 'Solo le agenzie possono segnalare problemi' };
  }
  const agenziaId = session.user.companyId!;
  const userId = session.user.id;

  const pratica = await prisma.pratica.findUnique({
    where: { id: praticaId },
    select: {
      id: true,
      stato: true,
      agenziaAssegnataId: true,
      // Le 4 colonne che `canAccessPratica` esige: il gate sede non compila
      // senza. `brokerId`/`brokerSedeId` servono al lato broker della regola.
      brokerId: true,
      brokerSedeId: true,
      agenziaSedeId: true,
      flagSegnalata: true,
      codicePratica: true,
      veicoli: { orderBy: { ordine: 'asc' }, select: { id: true, targa: true } },
      broker: { select: { ragioneSociale: true } },
      agenziaAssegnata: { select: { ragioneSociale: true } },
    },
  });
  if (!pratica) return { ok: false, error: 'Pratica non trovata' };
  if (pratica.agenziaAssegnataId !== agenziaId) {
    return { ok: false, error: 'Pratica non assegnata alla tua agenzia' };
  }
  // Scoping sede: segnalare apre una penale di €25 a carico del broker. Senza
  // questo gate un utente della sede A poteva segnalare la pratica accettata
  // dalla sede B, contro un broker con cui non ha mai lavorato.
  const ctx = await getSessionContext();
  const scope = ctx ? toSedeScope(ctx) : NO_SEDE_SCOPE;
  if (!canAccessPratica(pratica, { companyId: agenziaId, isAdminPiattaforma: false, scope })) {
    return { ok: false, error: 'Pratica non assegnata alla tua sede' };
  }
  if (pratica.stato !== 'ACCETTATA' && pratica.stato !== 'PROCESSATA') {
    return {
      ok: false,
      error: 'Le segnalazioni sono possibili solo prima della firma',
    };
  }
  if (pratica.flagSegnalata) {
    return { ok: false, error: 'Hai già segnalato questa pratica' };
  }

  // Base di calcolo della penale (€25 × veicoli segnalati): va validata qui,
  // non lato client. Un POST forgiato con veicoli altrui gonfierebbe la penale
  // di un broker a piacere.
  if (veicoliIds.length === 0) {
    return { ok: false, error: 'Seleziona almeno un veicolo' };
  }
  const idsPratica = new Set(pratica.veicoli.map((v) => v.id));
  if (!veicoliIds.every((id) => idsPratica.has(id))) {
    return { ok: false, error: 'Veicolo non appartenente alla pratica' };
  }

  const cleanNota = nota.trim().slice(0, 500) || null;

  // Deduplicazione defensiva: i duplicati sono innocui (updateMany li collassa),
  // ma il codice calcola una penale in denaro e non deve dipendere dalla
  // semantica SQL.
  const idsUnici = [...new Set(veicoliIds)];

  await prisma.$transaction([
    prisma.pratica.update({
      where: { id: praticaId },
      data: {
        flagSegnalata: true,
        tipoSegnalazione: tipo,
        notaSegnalazione: cleanNota,
        segnalataAt: new Date(),
        segnalataDaUserId: userId,
        segnalazioneStato: 'RICEVUTA',
      },
    }),
    prisma.veicolo.updateMany({
      where: { praticaId, id: { in: idsUnici } },
      data: { segnalato: true },
    }),
  ]);

  // Notifica admin platform — best effort
  try {
    const admins = await getAdminEmails();
    for (const a of admins) {
      await sendNotification({
        tipo: 'N19_ADMIN_NUOVA_SEGNALAZIONE',
        target: { email: a.email, userId: a.userId },
        payload: {
          codicePratica: pratica.codicePratica ?? '—',
          targa:
            pratica.veicoli[0]?.targa
              ? pratica.veicoli.length > 1
                ? `${pratica.veicoli[0].targa} +${pratica.veicoli.length - 1}`
                : pratica.veicoli[0].targa
              : null,
          brokerRagioneSociale: pratica.broker.ragioneSociale,
          agenziaRagioneSociale:
            pratica.agenziaAssegnata?.ragioneSociale ?? '—',
          tipoSegnalazione: tipo,
          notaSegnalazione: cleanNota,
        },
      }).catch(() => undefined);
    }
  } catch {
    // best-effort
  }

  revalidatePath('/pratiche');
  revalidatePath(`/pratiche/${praticaId}`);
  revalidatePath('/admin/segnalazioni');
  return { ok: true };
}

export type GestioneSegnalazioneResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * L'admin platform conferma la segnalazione: pratica annullata, penale
 * addebitata al broker (può portare il wallet sotto zero), fee agenzia
 * non addebitata. Notifica broker + agenzia.
 */
export async function confermaAnnullamentoConPenaleAction(
  praticaId: string,
): Promise<GestioneSegnalazioneResult> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return {
      ok: false,
      error: "Solo l'admin platform può confermare segnalazioni",
    };
  }
  const adminId = session.user.id;

  let payload: {
    codicePratica: string;
    targa: string | null;
    tipoSegnalazione: SegnalazioneTipo;
    importoPenaleCent: number;
    veicoliSegnalatiTarghe: string[];
    saldoBroker: number;
    brokerEmail: string | null;
    brokerUserId: string | null;
    brokerCompanyId: string;
    brokerSedeId: string | null;
    brokerNome: string;
    agenziaCompanyId: string | null;
    agenziaSedeId: string | null;
    agenziaNome: string;
  } | null = null;

  try {
    payload = await prisma.$transaction(async (tx) => {
      const pratica = await tx.pratica.findUnique({
        where: { id: praticaId },
        include: {
          broker: {
            include: {
              wallet: true,
              users: {
                where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
                select: { id: true, email: true, nome: true },
                take: 1,
              },
            },
          },
          agenziaAssegnata: {
            include: {
              users: {
                where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
                select: { id: true, email: true },
                take: 1,
              },
            },
          },
          veicoli: {
            orderBy: { ordine: 'asc' },
            select: { targa: true, segnalato: true },
          },
        },
      });
      if (!pratica) throw new Error('Pratica non trovata');
      if (!pratica.flagSegnalata) {
        throw new Error('Pratica senza segnalazione attiva');
      }
      if (pratica.segnalazioneStato !== 'RICEVUTA') {
        throw new Error('Segnalazione già gestita');
      }
      if (pratica.stato === 'ANNULLATA' || pratica.stato === 'FIRMATA') {
        throw new Error('Pratica non più gestibile');
      }

      const now = new Date();
      // Penale = €25 × veicoli SEGNALATI. Mai sui veicoli sani: sarebbe una
      // penale sproporzionata rispetto all'inadempimento (riducibile ex art.
      // 1384 c.c.) e contraddirebbe il presupposto dichiarato nel popup.
      // Fallback su 1 per le segnalazioni legacy (create prima che il campo
      // `segnalato` esistesse): mai 0 — non addebiteremmo nulla.
      const veicoliSegnalati = pratica.veicoli.filter((v) => v.segnalato).length;
      const nPenali = veicoliSegnalati > 0 ? veicoliSegnalati : 1;
      const importoPenaleCent = PENALI.PENALE_BROKER_DEFAULT_CENT * nPenali;

      // Wallet operativo della pratica: quello della SEDE del broker. Cercarlo
      // per companyId ne creava uno nuovo "madre", invisibile a operatori e
      // admin di sede — e lo storno qui sotto non trovava mai il credito.
      const wallet = await walletBrokerDellaPratica(tx, pratica);
      let saldo = wallet.saldoCent;

      // Storno del compenso pratica SOLO se già accreditato. Di norma la
      // segnalazione è pre-firma e il CREDITO_PRATICA non esiste ancora → il
      // blocco non scatta (il broker semplicemente non matura il compenso).
      // Difensivo per l'edge case di credito già presente (impatto −€50).
      const creditoPratica = await tx.transazioneWallet.findFirst({
        where: {
          walletId: wallet.id,
          praticaId: pratica.id,
          tipo: 'CREDITO_PRATICA',
        },
      });
      if (creditoPratica && creditoPratica.importoCent > 0) {
        saldo -= creditoPratica.importoCent;
        await tx.transazioneWallet.create({
          data: {
            walletId: wallet.id,
            tipo: 'STORNO',
            importoCent: -creditoPratica.importoCent,
            saldoPostCent: saldo,
            praticaId: pratica.id,
          },
        });
      }

      // Penale broker (può portare il wallet sotto zero). Il motivo (tipo
      // segnalazione) viene salvato nella nota così il movimento wallet può
      // esplicitare al broker perché è stato addebitato.
      const tipoSeg = (pratica.tipoSegnalazione ?? 'ALTRO') as SegnalazioneTipo;
      saldo -= importoPenaleCent;
      await tx.transazioneWallet.create({
        data: {
          walletId: wallet.id,
          tipo: 'PENALE_BROKER',
          importoCent: -importoPenaleCent,
          saldoPostCent: saldo,
          praticaId: pratica.id,
          note: motivoPenaleSegnalazione(tipoSeg),
        },
      });

      const newSaldo = saldo;
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { saldoCent: newSaldo },
      });

      // Pratica: ANNULLATA + segnalazione CONFERMATA + penale addebitata
      await tx.pratica.update({
        where: { id: praticaId },
        data: {
          stato: 'ANNULLATA',
          annullataAt: now,
          segnalazioneStato: 'CONFERMATA',
          segnalazioneEsitaAt: now,
          segnalazioneEsitaDaId: adminId,
          penaleAddebitatoCent: importoPenaleCent,
        },
      });

      // Eventuali FeeAddebito SCHEDULED per l'agenzia: annulliamo (rimborso)
      await tx.feeAddebito.updateMany({
        where: { praticaId, stato: 'SCHEDULED' },
        data: { stato: 'ANNULLATO' },
      });

      // Assegnazioni pending → ASSEGNATA_ALTRO per chiusura
      await tx.praticaAssegnazione.updateMany({
        where: { praticaId, esito: 'PENDING' },
        data: { esito: 'ASSEGNATA_ALTRO', esitoAt: now },
      });

      const brokerUser = pratica.broker.users[0];

      return {
        codicePratica: pratica.codicePratica ?? '—',
        targa:
          pratica.veicoli[0]?.targa
            ? pratica.veicoli.length > 1
              ? `${pratica.veicoli[0].targa} +${pratica.veicoli.length - 1}`
              : pratica.veicoli[0].targa
            : null,
        tipoSegnalazione:
          (pratica.tipoSegnalazione ?? 'ALTRO') as SegnalazioneTipo,
        importoPenaleCent,
        veicoliSegnalatiTarghe: pratica.veicoli
          .filter((v) => v.segnalato)
          .map((v) => v.targa ?? '—'),
        saldoBroker: newSaldo,
        brokerEmail: brokerUser?.email ?? pratica.broker.email,
        brokerUserId: brokerUser?.id ?? null,
        brokerCompanyId: pratica.brokerId,
        brokerSedeId: pratica.brokerSedeId,
        brokerNome: brokerUser?.nome ?? pratica.broker.ragioneSociale,
        agenziaCompanyId: pratica.agenziaAssegnataId,
        agenziaSedeId: pratica.agenziaSedeId,
        agenziaNome:
          pratica.agenziaAssegnata?.ragioneSociale ?? '—',
      };
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  // Post-commit: notifiche best-effort
  try {
    if (payload.brokerEmail) {
      await sendNotification({
        tipo: 'N17_BROKER_PENALE_ADDEBITATA',
        target: {
          email: payload.brokerEmail,
          userId: payload.brokerUserId,
          companyId: payload.brokerCompanyId,
        },
        payload: {
          nomeBroker: payload.brokerNome,
          codicePratica: payload.codicePratica,
          targa: payload.targa,
          tipoSegnalazione: payload.tipoSegnalazione,
          importoPenaleCent: payload.importoPenaleCent,
          veicoliSegnalati: payload.veicoliSegnalatiTarghe,
          saldoWalletCent: payload.saldoBroker,
        },
      }, { praticaId }).catch(() => undefined);
    }
    // Destinatario: chi ha accettato la pratica, poi la sua sede, poi
    // l'admin azienda. Vedi lib/notifiche/pratica.ts.
    const destinatariAg = await destinatariAgenzia(praticaId);
    for (const d of destinatariAg) {
      await sendNotification({
        tipo: 'N18_AGENZIA_SEGNALAZIONE_CONFERMATA',
        target: {
          email: d.email,
          userId: d.userId,
          companyId: payload.agenziaCompanyId,
        },
        payload: {
          nomeAgenzia: payload.agenziaNome,
          codicePratica: payload.codicePratica,
          targa: payload.targa,
          tipoSegnalazione: payload.tipoSegnalazione,
        },
      }, { praticaId }).catch(() => undefined);
    }
  } catch {
    // best-effort
  }

  // Eventi in-app (modale): penale per il broker, segnalazione confermata per l'agenzia.
  if (payload) {
    try {
      await emitEventiPratica(prisma, [
        eventoPraticaPenale({
          praticaId,
          targetCompanyId: payload.brokerCompanyId,
          sedeId: payload.brokerSedeId,
          codicePratica: payload.codicePratica,
          ruolo: 'broker',
        }),
        ...(payload.agenziaCompanyId
          ? [
              eventoPraticaPenale({
                praticaId,
                targetCompanyId: payload.agenziaCompanyId,
                sedeId: payload.agenziaSedeId,
                codicePratica: payload.codicePratica,
                ruolo: 'agenzia',
              }),
            ]
          : []),
      ]);
    } catch {
      // best-effort
    }
  }

  // Email cliente: pratica annullata a seguito di penale confermata.
  await notifyClientiAvanzamento(praticaId, 'ANNULLATA').catch(() => undefined);

  revalidatePath('/admin/segnalazioni');
  revalidatePath('/admin/pratiche');
  revalidatePath(`/pratiche/${praticaId}`);
  return { ok: true };
}

/**
 * L'admin respinge la segnalazione: la pratica torna live, agenzia continua
 * la lavorazione. Nessuna penale.
 */
export async function respingiSegnalazioneAction(
  praticaId: string,
  motivo: string,
): Promise<GestioneSegnalazioneResult> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return {
      ok: false,
      error: "Solo l'admin platform può respingere segnalazioni",
    };
  }
  const adminId = session.user.id;
  const motivoTrim = motivo.trim().slice(0, 500);

  let payload: {
    codicePratica: string;
    targa: string | null;
    tipoSegnalazione: SegnalazioneTipo;
    agenziaCompanyId: string | null;
    agenziaNome: string;
  } | null = null;

  // Transazione: reset di `flagSegnalata` e reset dei veicoli segnalati devono
  // essere atomici. Se il secondo fallisse dopo che il primo è già passato, la
  // pratica risulterebbe "non segnalata" ma con i veicoli ancora marcati — la
  // segnalazione successiva sulla stessa pratica erediterebbe la penale su
  // veicoli che nessuno ha mai segnalato.
  try {
    payload = await prisma.$transaction(async (tx) => {
      const pratica = await tx.pratica.findUnique({
        where: { id: praticaId },
        select: {
          flagSegnalata: true,
          segnalazioneStato: true,
          notaSegnalazione: true,
          codicePratica: true,
          tipoSegnalazione: true,
          agenziaAssegnataId: true,
          veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
          agenziaAssegnata: { select: { ragioneSociale: true } },
        },
      });
      if (!pratica) throw new Error('Pratica non trovata');
      if (!pratica.flagSegnalata || pratica.segnalazioneStato !== 'RICEVUTA') {
        throw new Error('Nessuna segnalazione attiva da respingere');
      }

      await tx.pratica.update({
        where: { id: praticaId },
        data: {
          flagSegnalata: false,
          segnalazioneStato: 'RESPINTA',
          segnalazioneEsitaAt: new Date(),
          segnalazioneEsitaDaId: adminId,
          // Conserviamo nota originale agenzia + appendiamo motivo respinta in audit
          notaSegnalazione: motivoTrim
            ? `[ORIG] ${pratica.notaSegnalazione ?? ''}\n[RESPINTA] ${motivoTrim}`
            : pratica.notaSegnalazione,
        },
      });

      // Reset dei veicoli: una segnalazione respinta non deve lasciare traccia,
      // altrimenti la successiva calcolerebbe la penale su veicoli mai segnalati.
      await tx.veicolo.updateMany({
        where: { praticaId },
        data: { segnalato: false },
      });

      return {
        codicePratica: pratica.codicePratica ?? '—',
        targa:
          pratica.veicoli[0]?.targa
            ? pratica.veicoli.length > 1
              ? `${pratica.veicoli[0].targa} +${pratica.veicoli.length - 1}`
              : pratica.veicoli[0].targa
            : null,
        tipoSegnalazione: (pratica.tipoSegnalazione ?? 'ALTRO') as SegnalazioneTipo,
        agenziaCompanyId: pratica.agenziaAssegnataId,
        agenziaNome: pratica.agenziaAssegnata?.ragioneSociale ?? '—',
      };
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  // Post-commit: notifica l'agenzia che aveva segnalato — best-effort. Clausola
  // 10.3 dei Termini: l'esito (anche il respingimento) va comunicato a entrambe
  // le parti; prima di questa notifica l'agenzia non veniva mai avvisata.
  try {
    const destinatariAg = await destinatariAgenzia(praticaId);
    for (const d of destinatariAg) {
      await sendNotification({
        tipo: 'N43_AGENZIA_SEGNALAZIONE_RESPINTA',
        target: {
          email: d.email,
          userId: d.userId,
          companyId: payload.agenziaCompanyId,
        },
        payload: {
          nomeAgenzia: payload.agenziaNome,
          codicePratica: payload.codicePratica,
          targa: payload.targa,
          tipoSegnalazione: payload.tipoSegnalazione,
          motivo: motivoTrim,
        },
      }, { praticaId }).catch(() => undefined);
    }
  } catch {
    // best-effort
  }

  revalidatePath('/admin/segnalazioni');
  revalidatePath(`/pratiche/${praticaId}`);
  return { ok: true };
}
