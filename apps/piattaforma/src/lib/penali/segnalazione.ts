'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { sendNotification, getAdminEmails, notifyClientiAvanzamento } from '@/lib/notifiche';
import { emitEventiPratica } from '@/lib/eventi/emit';
import { eventoPraticaPenale } from '@/lib/eventi/pratica-eventi';
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
): Promise<SegnalaPraticaResult> {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
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
      flagSegnalata: true,
      codicePratica: true,
      veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
      broker: { select: { ragioneSociale: true } },
      agenziaAssegnata: { select: { ragioneSociale: true } },
    },
  });
  if (!pratica) return { ok: false, error: 'Pratica non trovata' };
  if (pratica.agenziaAssegnataId !== agenziaId) {
    return { ok: false, error: 'Pratica non assegnata alla tua agenzia' };
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

  const cleanNota = nota.trim().slice(0, 500) || null;

  await prisma.pratica.update({
    where: { id: praticaId },
    data: {
      flagSegnalata: true,
      tipoSegnalazione: tipo,
      notaSegnalazione: cleanNota,
      segnalataAt: new Date(),
      segnalataDaUserId: userId,
      segnalazioneStato: 'RICEVUTA',
    },
  });

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
    saldoBroker: number;
    brokerEmail: string | null;
    brokerUserId: string | null;
    brokerCompanyId: string;
    brokerSedeId: string | null;
    brokerNome: string;
    agenziaEmail: string | null;
    agenziaUserId: string | null;
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
                where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE' },
                select: { id: true, email: true, nome: true },
                take: 1,
              },
            },
          },
          agenziaAssegnata: {
            include: {
              users: {
                where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE' },
                select: { id: true, email: true },
                take: 1,
              },
            },
          },
          veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
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
      const importoPenaleCent = PENALI.PENALE_BROKER_DEFAULT_CENT;

      // Wallet broker (lazy create)
      const wallet = await tx.wallet.upsert({
        where: { companyId: pratica.brokerId },
        update: {},
        create: { companyId: pratica.brokerId, saldoCent: 0 },
      });
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

      // Penale broker (può portare il wallet sotto zero)
      saldo -= importoPenaleCent;
      await tx.transazioneWallet.create({
        data: {
          walletId: wallet.id,
          tipo: 'PENALE_BROKER',
          importoCent: -importoPenaleCent,
          saldoPostCent: saldo,
          praticaId: pratica.id,
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
      const agenziaUser = pratica.agenziaAssegnata?.users[0];

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
        saldoBroker: newSaldo,
        brokerEmail: brokerUser?.email ?? null,
        brokerUserId: brokerUser?.id ?? null,
        brokerCompanyId: pratica.brokerId,
        brokerSedeId: pratica.brokerSedeId,
        brokerNome: brokerUser?.nome ?? pratica.broker.ragioneSociale,
        agenziaEmail: agenziaUser?.email ?? null,
        agenziaUserId: agenziaUser?.id ?? null,
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
          importoPenaleCent: PENALI.PENALE_BROKER_DEFAULT_CENT,
          saldoWalletCent: payload.saldoBroker,
        },
      }).catch(() => undefined);
    }
    if (payload.agenziaEmail) {
      await sendNotification({
        tipo: 'N18_AGENZIA_SEGNALAZIONE_CONFERMATA',
        target: {
          email: payload.agenziaEmail,
          userId: payload.agenziaUserId,
          companyId: payload.agenziaCompanyId,
        },
        payload: {
          nomeAgenzia: payload.agenziaNome,
          codicePratica: payload.codicePratica,
          targa: payload.targa,
          tipoSegnalazione: payload.tipoSegnalazione,
        },
      }).catch(() => undefined);
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

  const pratica = await prisma.pratica.findUnique({
    where: { id: praticaId },
    select: {
      flagSegnalata: true,
      segnalazioneStato: true,
      notaSegnalazione: true,
    },
  });
  if (!pratica) return { ok: false, error: 'Pratica non trovata' };
  if (!pratica.flagSegnalata || pratica.segnalazioneStato !== 'RICEVUTA') {
    return { ok: false, error: 'Nessuna segnalazione attiva da respingere' };
  }

  const motivoTrim = motivo.trim().slice(0, 500);
  await prisma.pratica.update({
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

  revalidatePath('/admin/segnalazioni');
  revalidatePath(`/pratiche/${praticaId}`);
  return { ok: true };
}
