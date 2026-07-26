import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { sendNotification, notifyClientiAvanzamento } from '@/lib/notifiche';
import { destinatariBroker } from '@/lib/notifiche/pratica';
import {
  accreditCommissioniAffiliazione,
  type AccreditoEseguito,
} from '@/lib/affiliazione/accredit';
import {
  notifyReferralFirstPratica,
  notifyPayoutThresholdCrossed,
} from '@/lib/affiliazione/notifications';
import { onPraticaFirmata } from '@/lib/crm/sync';
import { isAgenziaBloccata } from '@/lib/fee/blocco';
import { isVisuraScadutaCompany } from '@/lib/visura/stato';
import { isPaymentLive } from '@/lib/jobs/payment-live';
import { createFatturaPv } from '@/lib/fatturazione/engine';
import { fatturaPvAttachment } from '@/lib/fatturazione/documento-pdf';
import { autoPayoutBrokerDopoFirma } from '@/lib/wallet/auto-payout';
import { emitEventoPratica } from '@/lib/eventi/emit';
import { eventoPraticaFirmata } from '@/lib/eventi/pratica-eventi';
import { getSessionContext } from '@/lib/auth/session-context';
import { toSedeScope, NO_SEDE_SCOPE, type SedeScope } from '@/lib/sedi/scope-filters';
import { canAccessPratica } from '@/lib/pratiche/access';
import { requirePermesso } from '@/lib/auth/permessi/guard';
import { motivoBloccoFirma } from '@/lib/pratiche/firma-gate';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { env } from '@/env';
import type { QuickActionResult } from '@/lib/pratiche/quick-action';
import { logCambioStato, STATO_EVENTO } from '@/lib/pratiche/stato-log';

/**
 * Scope sede della sessione corrente.
 *
 * Costa 2 query (`sede.findMany` + `userSede.findMany`): la memoizzazione di
 * `cache()` è per-request, e una Server Action è una request a sé. Va chiamata
 * PRIMA di aprire la `$transaction`, così non ne allunga la durata.
 *
 * Condivisa con `actions.ts` (`processaPraticaCore`, `annullaPraticaAction`,
 * `submitValutazioneAction`): vive qui perché `actions.ts` ha `'use server'` e
 * lì ogni export diventa un endpoint HTTP invocabile dal client — questa non
 * deve esserlo.
 */
export async function sedeScopeCorrente(): Promise<SedeScope> {
  const ctx = await getSessionContext();
  return ctx ? toSedeScope(ctx) : NO_SEDE_SCOPE;
}

/**
 * Gate di SCRITTURA per sede.
 *
 * La lettura è già scopata (lista, dettaglio, download), ma senza questo gate un
 * utente che conosce l'UUID muta la pratica di un'altra filiale: la marca
 * firmata, accredita quel wallet, genera un FeeAddebito a carico della madre.
 * Stessa identica regola della lettura (`canAccessPratica`): company del lato +
 * sede di quel lato, nessun bypass per la vista aggregata, fail-closed.
 *
 * Va chiamato SEMPRE dopo il controllo di company, così il messaggio distingue
 * "non è tua" da "non è della tua sede".
 */
export function assertSedeInScope(
  pratica: {
    brokerId: string;
    brokerSedeId: string | null;
    agenziaAssegnataId: string | null;
    agenziaSedeId: string | null;
  },
  companyId: string,
  scope: SedeScope,
): void {
  if (!canAccessPratica(pratica, { companyId, isAdminPiattaforma: false, scope })) {
    throw new Error('Pratica non assegnata alla tua sede');
  }
}

/**
 * AF-N: notifiche affiliazione post-firma. Per ogni accredit eseguito:
 *  - N24 al referente se il saldo wallet ha attraversato la soglia payout
 *  - N23 al referente del broker se questa è la prima pratica firmata del broker
 */
async function notifyAffiliationPostFirma(
  praticaId: string,
  accrediti: AccreditoEseguito[],
): Promise<void> {
  if (accrediti.length === 0) return;
  try {
    const pratica = await prisma.pratica.findUnique({
      where: { id: praticaId },
      select: { id: true, codicePratica: true, brokerId: true },
    });
    if (!pratica) return;

    // Conta firme precedenti del broker (escludendo la corrente).
    const firmateBefore = await prisma.pratica.count({
      where: {
        brokerId: pratica.brokerId,
        deletedAt: null,
        stato: 'FIRMATA',
        id: { not: praticaId },
      },
    });
    const isFirstFirmaForBroker = firmateBefore === 0;

    for (const acc of accrediti) {
      // N24: cross-over soglia payout
      void notifyPayoutThresholdCrossed({
        referenteCompanyId: acc.referenteId,
        prevSaldoCent: acc.walletPreCent,
        newSaldoCent: acc.walletPostCent,
      });

      // N23: prima pratica del referral (solo per il referente broker)
      if (isFirstFirmaForBroker && acc.tipo === 'REFERENTE_BROKER') {
        void notifyReferralFirstPratica({
          brokerCompanyId: pratica.brokerId,
          codicePratica: pratica.codicePratica ?? pratica.id.slice(0, 8),
          importoCommissioneCent: acc.importoCent,
        });
      }
    }
  } catch {
    // best-effort
  }
}

/**
 * Chi sta firmando. Il MOTORE degli effetti (wallet, addebito, fattura,
 * affiliazione, email, payout) è lo stesso per entrambi: duplicarlo
 * significherebbe, prima o poi, una fattura che non parte o un payout che non
 * scatta. Cambiano solo i gate e ciò che si scrive in più.
 */
// Niente `userId` qui: l'autore di un'attestazione ADMIN (Termini art. 11, che
// muove denaro vero) DEVE venire dalla sessione autenticata, mai da un campo
// dichiarato dal chiamante — altrimenti un'action futura che leggesse lo
// userId da un form scriverebbe un'attribuzione falsa e il motore non se ne
// accorgerebbe (due fonti di verità che possono divergere). Stesso pattern di
// `lib/penali/segnalazione.ts` (`const adminId = session.user.id`).
export type AttoreFirma = { tipo: 'AGENZIA' } | { tipo: 'ADMIN'; motivo: string };

export async function firmaPraticaCore(
  praticaId: string,
  attore: AttoreFirma,
): Promise<QuickActionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');

  // Gate specifici del percorso AGENZIA. Non sono comuni: l'admin non ha
  // companyId, non ha permessi azienda e non ha scope sede.
  let agenziaSessione: string | null = null;
  let scope: Awaited<ReturnType<typeof sedeScopeCorrente>> | null = null;
  // Autore dell'attestazione ADMIN: SEMPRE da `session.user.id`, MAI da
  // `attore` (il tipo non lo espone più — vedi commento su AttoreFirma sopra).
  let adminId: string | null = null;

  if (attore.tipo === 'AGENZIA') {
    // Autenticazione → permesso → scope. Copre entrambi i wrapper (dettaglio e
    // lista). Sensibile: la firma accredita il wallet broker e genera fattura.
    const gate = await requirePermesso('pratiche.firma');
    if (!gate.ok) return gate;

    if (session.user.companyType !== 'AGENZIA') {
      redirect('/dashboard');
    }
    agenziaSessione = session.user.companyId!;
    if (await isAgenziaBloccata(agenziaSessione)) redirect('/blocco-pagamento');
    // Ciclo di vita della visura camerale (clausola 8 dei Termini). Solo nel
    // ramo AGENZIA: l'admin che attesta una firma (Termini art. 11, ramo
    // `else` sotto) non deve essere bloccato dalla visura dell'agenzia
    // assegnata alla pratica.
    if (await isVisuraScadutaCompany(agenziaSessione)) redirect('/visura');
    scope = await sedeScopeCorrente();
  } else {
    // Attestazione admin (Termini art. 11). ASSISTENTE escluso: l'azione muove
    // denaro (addebito all'agenzia, credito al broker, fattura, payout).
    if (!isAdminPiattaforma(session.user.role)) redirect('/dashboard');
    if (!attore.motivo.trim()) {
      return { ok: false, error: 'La motivazione è obbligatoria' };
    }
    adminId = session.user.id;
  }

  let accreditiResult: AccreditoEseguito[] = [];
  // Id del FeeAddebito creato nella transazione di firma: è l'ingresso sia
  // della fattura sia dell'addebito.
  let feeAddebitoIdCreato: string | null = null;
  // L'agenzia da addebitare/fatturare: sempre quella ASSEGNATA alla pratica,
  // non quella in sessione (l'admin non ne ha una).
  let agenziaIdEffettivo = '';

  try {
    await prisma.$transaction(async (tx) => {
      const pratica = await tx.pratica.findUnique({
        where: { id: praticaId },
        include: {
          broker: {
            include: {
              referente: {
                select: { id: true, suspendedAt: true, deletedAt: true },
              },
            },
          },
          agenziaAssegnata: {
            include: {
              referente: {
                select: { id: true, suspendedAt: true, deletedAt: true },
              },
            },
          },
        },
      });
      if (!pratica) throw new Error('Pratica non trovata');

      // Appartenenza PRIMA dello stato: è una difesa, non estetica. Se
      // `motivoBloccoFirma` girasse per primo, un'agenzia che passa l'UUID di
      // una pratica altrui riceverebbe messaggi distinguibili ("deve essere
      // prima processata", "segnalazione in verifica", ...) e da quelli
      // dedurrebbe lo stato di lavorazione di una pratica che non è sua. Con
      // l'appartenenza per prima, riceve sempre e solo "non assegnata a
      // questa agenzia", qualunque sia lo stato reale.
      if (attore.tipo === 'AGENZIA') {
        if (pratica.agenziaAssegnataId !== agenziaSessione) {
          throw new Error('Pratica non assegnata a questa agenzia');
        }
        assertSedeInScope(pratica, agenziaSessione!, scope!);
      }

      // Gate COMUNI ai due percorsi (stato, segnalazione, agenzia assegnata).
      const blocco = motivoBloccoFirma({
        stato: pratica.stato,
        flagSegnalata: pratica.flagSegnalata,
        agenziaAssegnataId: pratica.agenziaAssegnataId,
      });
      if (blocco) throw new Error(blocco);

      agenziaIdEffettivo = pratica.agenziaAssegnataId!; // garantito da motivoBloccoFirma

      const now = new Date();
      // Addebito istantaneo: dovuto subito (niente programmazione nel futuro).
      const autoAddebitoAt = now;

      // Compare-and-set, non leggi-poi-scrivi: a READ COMMITTED (default
      // Postgres/Prisma) due transazioni concorrenti possono leggere entrambe
      // PROCESSATA sopra, superare entrambe `motivoBloccoFirma` e — con un
      // `update` semplice — scrivere entrambe FIRMATA. Scenario concreto di
      // questa feature: l'admin telefona all'agenzia per attestare, e la
      // telefonata stessa spinge l'agenzia a cliccare "Firma avvenuta" negli
      // stessi secondi. Il risultato sarebbe un doppio `FeeAddebito` (agenzia
      // addebitata due volte) e un doppio credito wallet al broker: non
      // esiste un vincolo unique che lo impedisca a valle.
      //
      // Le precondizioni dello stato entrano nel WHERE: solo la transazione
      // che le trova ancora vere scrive. `motivoBloccoFirma` resta comunque
      // la difesa che sceglie IL messaggio (stato sbagliato vs segnalazione
      // vs agenzia mancante); questo `updateMany` è la rete finale, non il
      // sostituto — se arriva a `count === 0` è perché qualcun altro ha
      // vinto la corsa tra la lettura sopra e questa scrittura.
      const { count } = await tx.pratica.updateMany({
        where: { id: praticaId, stato: 'PROCESSATA', flagSegnalata: false },
        data: {
          stato: 'FIRMATA',
          firmaAvvenutaAt: now,
          autoAddebitoAt,
          ...(attore.tipo === 'ADMIN'
            ? {
                // adminId è garantito non-null qui: è impostato nell'unico
                // ramo (attore.tipo === 'ADMIN' sopra) che porta a questo
                // punto, subito dopo la verifica del ruolo — mai dal parametro.
                firmaForzataDaId: adminId!,
                firmaForzataAt: now,
                firmaForzataMotivo: attore.motivo.trim().slice(0, 500),
              }
            : {}),
        },
      });
      if (count === 0) {
        throw new Error('Pratica già firmata o non più firmabile');
      }

      // Da qui in poi il CAS ha avuto effetto (count > 0): logga la
      // transizione di stato nella stessa tx, prima degli altri side-effect.
      await logCambioStato(tx, {
        praticaId,
        statoDa: 'PROCESSATA',
        statoA: 'FIRMATA',
        tipoEvento: STATO_EVENTO.SIGN,
        // Copre entrambi i percorsi: firmatario agenzia o admin che attesta
        // (in quel ramo `adminId === session.user.id`, vedi sopra).
        attoreUserId: session.user.id,
      });

      // Credito wallet broker (proventi pratica) — multi-sede: wallet della sede.
      if (pratica.creditoBrokerCent > 0 && pratica.brokerSedeId) {
        const wallet = await tx.wallet.upsert({
          where: { sedeId: pratica.brokerSedeId },
          update: {},
          create: { sedeId: pratica.brokerSedeId, saldoCent: 0 },
        });
        // Incremento atomico (no leggi-poi-scrivi): il saldo post lo prendo dal
        // valore restituito dall'UPDATE, così due accrediti concorrenti sullo
        // stesso wallet non si sovrascrivono (lost update).
        const w = await tx.wallet.update({
          where: { id: wallet.id },
          data: { saldoCent: { increment: pratica.creditoBrokerCent } },
        });
        await tx.transazioneWallet.create({
          data: {
            walletId: wallet.id,
            tipo: 'CREDITO_PRATICA',
            importoCent: pratica.creditoBrokerCent,
            saldoPostCent: w.saldoCent,
            praticaId: pratica.id,
          },
        });
      }

      // Fee addebito istantaneo (Stripe reale in Fase 5): scheduledAt = now, così
      // il job process-fee-scheduled lo prende al primo giro, senza attese.
      if (pratica.feeAgenziaCent > 0) {
        const feeCreato = await tx.feeAddebito.create({
          data: {
            praticaId: pratica.id,
            agenziaId: agenziaIdEffettivo,
            // Multi-sede: l'addebito appartiene alla SEDE che ha lavorato la pratica.
            // Senza questo, /addebiti (scopato per sede) non vedrebbe la riga.
            agenziaSedeId: pratica.agenziaSedeId,
            importoCent: pratica.feeAgenziaCent,
            tipo: 'ADDEBITO_FIRMA',
            stato: 'SCHEDULED',
            scheduledAt: autoAddebitoAt,
          },
          select: { id: true },
        });
        feeAddebitoIdCreato = feeCreato.id;
      }

      // FASE 13: commissioni affiliazione ai referenti di broker e/o agenzia
      // (skip se referente sospeso o eliminato).
      const accreditOut = await accreditCommissioniAffiliazione(tx, {
        praticaId: pratica.id,
        tipo: pratica.tipo as 'SEMPLICE' | 'MINIVOLTURA',
        numeroVeicoli: pratica.numeroVeicoli,
        brokerId: pratica.brokerId,
        // pratica.agenziaAssegnataId è string | null: con i due percorsi (AGENZIA
        // / ADMIN) la narrowing del gate AGENZIA non copre più questo punto.
        // agenziaIdEffettivo è lo stesso valore, già garantito non-null da
        // motivoBloccoFirma.
        agenziaAssegnataId: agenziaIdEffettivo,
        brokerReferente: pratica.broker.referente,
        agenziaReferente: pratica.agenziaAssegnata?.referente ?? null,
        // Multi-sede: sede della madre referente che ha affiliato (attribuzione).
        brokerReferenteSedeId: pratica.broker.referenteSedeId,
        agenziaReferenteSedeId: pratica.agenziaAssegnata?.referenteSedeId ?? null,
      });
      accreditiResult = accreditOut.accrediti;
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  // CRM-G: avanzamento stato CRM del broker (S7→S8 prima volta, S8→S9
  // ricorrente). Best-effort, non blocca il flusso firma.
  void onPraticaFirmata(praticaId);

  // FT-A: la fattura PV nasce all'INCASSO confermato (lib/fee/incasso.ts), non
  // qui: emetterla alla firma la renderebbe una fattura anticipata, con l'IVA
  // esigibile su denaro che può non arrivare mai.
  //
  // VALVOLA: con provider di pagamento `mock` nessun addebito parte (il gate è
  // in processFeeAddebito), quindi nessun fee arriverà mai a SUCCESS e la
  // fattura non nascerebbe affatto. In quel caso resta emessa qui, IN_ATTESA,
  // esattamente come prima di questo cambio. La valvola si chiude da sola il
  // giorno del go-live Stripe.
  if (feeAddebitoIdCreato && !isPaymentLive()) {
    await createFatturaPv({
      feeAddebitoId: feeAddebitoIdCreato,
      statoPagamento: 'IN_ATTESA',
    }).catch((err) => {
      console.error(
        `[firmaPratica] createFatturaPv fallita per fee ${feeAddebitoIdCreato} (pratica ${praticaId}):`,
        err,
      );
      return null;
    });
  }

  // AF-N: notifiche affiliazione post-firma (N23 prima pratica del referral,
  // N24 soglia payout attraversata). Best-effort, non blocca il flusso.
  void notifyAffiliationPostFirma(praticaId, accreditiResult);

  // N4 (broker) + N8 (agenzia): best-effort post-commit
  try {
    const full = await prisma.pratica.findUnique({
      where: { id: praticaId },
      include: {
        broker: {
          include: {
            wallet: true,
            users: {
              where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
              select: { email: true, nome: true, id: true },
              take: 1,
            },
          },
        },
        agenziaAssegnata: {
          include: {
            users: {
              where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
              select: { email: true, id: true },
              take: 1,
            },
          },
        },
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
      },
    });
    if (full) {
      const fullTarga =
        full.veicoli[0]?.targa
          ? full.veicoli.length > 1
            ? `${full.veicoli[0].targa} +${full.veicoli.length - 1}`
            : full.veicoli[0].targa
          : null;
      const brokerUser = full.broker.users[0];
      // Ripiega sull'email azienda se manca l'admin attivo: N4 non deve
      // sparire in silenzio (coerente con N3). N4 resta all'admin azienda,
      // non passa dal risolutore: espone credito e saldo wallet, dati
      // dell'entità legale.
      const brokerEmail = brokerUser?.email ?? full.broker.email;
      const nomeBroker = brokerUser?.nome ?? full.broker.ragioneSociale;
      if (brokerEmail) {
        await sendNotification({
          tipo: 'N4_BROKER_FIRMA_E_CREDITO',
          target: {
            email: brokerEmail,
            userId: brokerUser?.id ?? null,
            companyId: full.broker.id,
          },
          payload: {
            codicePratica: full.codicePratica ?? '—',
            targa: fullTarga,
            agenziaNome: full.agenziaAssegnata?.ragioneSociale ?? '—',
            creditoCent: full.creditoBrokerCent,
            saldoCent: full.broker.wallet?.saldoCent ?? 0,
            nomeBroker,
            // `Boolean`, non `!== null`: se un domani questa findUnique passasse a
            // `select` senza includere il campo, `undefined !== null` sarebbe TRUE e
            // la N4 affermerebbe un'attestazione mai avvenuta — su una firma normale
            // dell'agenzia, per iscritto, mentre le addebitiamo la fee.
            attestataDaPv: Boolean(full.firmaForzataAt),
            attestataDaPvAt: full.firmaForzataAt ?? null,
          },
        }, { praticaId }).catch(() => undefined);
      }

      // N31: recapito diverso da N4 -- chi lavora la pratica (creatore, sede,
      // admin azienda a scendere), non l'admin azienda soltanto.
      const destinatari = await destinatariBroker(praticaId);
      for (const d of destinatari) {
        await sendNotification({
          tipo: 'N31_VALUTA_AGENZIA',
          target: {
            email: d.email,
            userId: d.userId,
            companyId: full.broker.id,
          },
          payload: {
            codicePratica: full.codicePratica ?? '—',
            targa: fullTarga,
            agenziaNome: full.agenziaAssegnata?.ragioneSociale ?? '—',
            nomeBroker: d.nome,
            praticaUrl: `${env.NEXT_PUBLIC_APP_URL}/pratiche/${praticaId}`,
          },
        }, { praticaId }).catch(() => undefined);
      }

      const agenziaUser = full.agenziaAssegnata?.users[0];
      // Preferisci l'email di registrazione dell'admin azienda, ma ripiega su
      // Company.email se non c'è un admin attivo: un addebito non deve mai
      // sparire in silenzio (coerente con N3/N6/N9).
      const agenziaEmail = agenziaUser?.email ?? full.agenziaAssegnata?.email;
      if (full.agenziaAssegnata && agenziaEmail && full.autoAddebitoAt) {
        // Allega il PDF della fattura PV all'addebito. Best-effort: se la
        // fattura non c'è (fee 0) o il PDF fallisce, si invia senza allegato.
        const fatturaPdf = await fatturaPvAttachment(praticaId).catch(() => null);
        await sendNotification(
          {
            tipo: 'N8_AGENZIA_ADDEBITO',
            target: {
              email: agenziaEmail,
              userId: agenziaUser?.id ?? null,
              companyId: full.agenziaAssegnata.id,
            },
            payload: {
              codicePratica: full.codicePratica ?? '—',
              feeCent: full.feeAgenziaCent,
              autoAddebitoAt: full.autoAddebitoAt,
              nomeAgenzia: full.agenziaAssegnata.ragioneSociale,
              // Vedi la N4 sopra: `Boolean`, non `!== null`.
              attestataDaPv: Boolean(full.firmaForzataAt),
              attestataDaPvAt: full.firmaForzataAt ?? null,
            },
          },
          { praticaId, ...(fatturaPdf ? { attachments: [fatturaPdf] } : {}) },
        ).catch(() => undefined);
      }
      if (full.codicePratica) {
        await emitEventoPratica(
          prisma,
          eventoPraticaFirmata({
            praticaId,
            brokerId: full.broker.id,
            sedeId: full.brokerSedeId,
            codicePratica: full.codicePratica,
          }),
        ).catch(() => undefined);
      }
    }

    // N12: notifica ai referenti per ogni commissione affiliazione accreditata.
    const commissioni = await prisma.commissioneAffiliazione.findMany({
      where: { praticaId, stato: 'ACCREDITATA' },
      include: {
        pratica: {
          select: {
            codicePratica: true,
            veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
            broker: { select: { ragioneSociale: true } },
            agenziaAssegnata: { select: { ragioneSociale: true } },
          },
        },
        referente: {
          select: {
            id: true,
            ragioneSociale: true,
            email: true,
            wallet: { select: { saldoCent: true } },
            users: {
              where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE' },
              select: { id: true, email: true, nome: true },
              take: 1,
            },
          },
        },
      },
    });
    for (const c of commissioni) {
      const refUser = c.referente.users[0];
      if (!refUser) continue;
      const referralRagioneSociale =
        c.tipo === 'REFERENTE_BROKER'
          ? c.pratica.broker.ragioneSociale
          : c.pratica.agenziaAssegnata?.ragioneSociale ?? '—';
      await sendNotification({
        tipo: 'N12_AFFILIAZIONE_COMMISSIONE',
        target: {
          email: refUser.email,
          userId: refUser.id,
          companyId: c.referente.id,
        },
        payload: {
          codicePratica: c.pratica.codicePratica ?? '—',
          targa:
            c.pratica.veicoli[0]?.targa
              ? c.pratica.veicoli.length > 1
                ? `${c.pratica.veicoli[0].targa} +${c.pratica.veicoli.length - 1}`
                : c.pratica.veicoli[0].targa
              : null,
          nomeReferente: refUser.nome,
          referralRagioneSociale,
          tipoReferente: c.tipo,
          importoAccreditatoCent: c.importoNettoCent,
          saldoWalletCent: c.referente.wallet?.saldoCent ?? 0,
        },
      }, { praticaId }).catch(() => undefined);
    }
  } catch {
    // best-effort
  }

  // Email cliente: passaggio di proprietà completato.
  await notifyClientiAvanzamento(praticaId, 'COMPLETATA').catch(() => undefined);

  // Payout automatico (real-time): se il credito pratica ha portato il wallet
  // del broker alla soglia configurata, esegui SUBITO il payout (Strada B, come
  // il manuale). Best-effort; il cron `triggerAutoPayout` resta la rete di
  // sicurezza periodica per tutti i wallet (incl. affiliazione).
  await autoPayoutBrokerDopoFirma(praticaId).catch(() => undefined);

  revalidatePath('/dashboard');
  revalidatePath('/pratiche');
  revalidatePath(`/pratiche/${praticaId}`);
  return { ok: true };
}
