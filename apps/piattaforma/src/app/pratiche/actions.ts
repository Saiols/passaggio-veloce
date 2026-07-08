'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { sendNotification, notifyClientiAvanzamento } from '@/lib/notifiche';
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
import { createFatturaPv } from '@/lib/fatturazione/engine';
import { fatturaPvAttachment } from '@/lib/fatturazione/documento-pdf';
import { autoPayoutBrokerDopoFirma } from '@/lib/wallet/auto-payout';
import { emitEventoPratica } from '@/lib/eventi/emit';
import {
  eventoPraticaLavorata,
  eventoPraticaFirmata,
  eventoPraticaAnnullata,
} from '@/lib/eventi/pratica-eventi';
import { env } from '@/env';

/** Esito delle quick-action usate dalla lista pratiche (nessuna navigazione). */
export type QuickActionResult = { ok: true } | { ok: false; error: string };

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
 * Step intermedio del workflow (item 11 release 2026-05): l'agenzia segna la
 * pratica come "processata" quando ha completato la lavorazione e attende solo
 * la firma del cliente. Transizione forzata: ACCETTATA → PROCESSATA → FIRMATA.
 */
async function processaPraticaCore(praticaId: string): Promise<QuickActionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.companyType !== 'AGENZIA') {
    redirect('/dashboard');
  }
  const agenziaId = session.user.companyId!;
  if (await isAgenziaBloccata(agenziaId)) redirect('/blocco-pagamento');

  try {
    await prisma.$transaction(async (tx) => {
      const pratica = await tx.pratica.findUnique({ where: { id: praticaId } });
      if (!pratica) throw new Error('Pratica non trovata');
      if (pratica.agenziaAssegnataId !== agenziaId) {
        throw new Error('Pratica non assegnata a questa agenzia');
      }
      if (pratica.stato !== 'ACCETTATA') {
        throw new Error('Pratica non nello stato ACCETTATA');
      }

      await tx.pratica.update({
        where: { id: praticaId },
        data: {
          stato: 'PROCESSATA',
          processataAt: new Date(),
        },
      });
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  // N13: notifica al broker che la pratica è stata processata, manca solo la firma.
  try {
    const full = await prisma.pratica.findUnique({
      where: { id: praticaId },
      include: {
        broker: {
          include: {
            users: {
              where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
              select: { email: true, nome: true, id: true },
              take: 1,
            },
          },
        },
        agenziaAssegnata: {
          select: { ragioneSociale: true },
        },
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
      },
    });
    const brokerUser = full?.broker.users[0];
    // Ripiega sull'email azienda se manca l'admin attivo: la notifica non deve
    // sparire in silenzio (coerente con N3).
    const brokerEmail = brokerUser?.email ?? full?.broker.email;
    if (full && brokerEmail) {
      await sendNotification({
        tipo: 'N13_BROKER_PRATICA_PROCESSATA',
        target: {
          email: brokerEmail,
          userId: brokerUser?.id ?? null,
          companyId: full.broker.id,
        },
        payload: {
          codicePratica: full.codicePratica ?? '—',
          targa:
            full.veicoli[0]?.targa
              ? full.veicoli.length > 1
                ? `${full.veicoli[0].targa} +${full.veicoli.length - 1}`
                : full.veicoli[0].targa
              : null,
          agenziaNome: full.agenziaAssegnata?.ragioneSociale ?? '—',
          nomeBroker: brokerUser?.nome ?? full.broker.ragioneSociale,
        },
      }).catch(() => undefined);
    }
    if (full?.codicePratica) {
      await emitEventoPratica(
        prisma,
        eventoPraticaLavorata({
          praticaId,
          brokerId: full.broker.id,
          sedeId: full.brokerSedeId,
          codicePratica: full.codicePratica,
        }),
      ).catch(() => undefined);
    }
  } catch {
    // best-effort
  }

  // Email cliente: documenti pronti, si procede alla firma.
  await notifyClientiAvanzamento(praticaId, 'PRONTA_FIRMA').catch(() => undefined);

  revalidatePath('/dashboard');
  revalidatePath('/pratiche');
  revalidatePath(`/pratiche/${praticaId}`);
  return { ok: true };
}

/**
 * Wrapper per il DETTAGLIO pratica (form action): mantiene il comportamento
 * storico redirect + toast via query param sulla stessa pagina di dettaglio.
 */
export async function markPraticaProcessataAction(praticaId: string): Promise<void> {
  const res = await processaPraticaCore(praticaId);
  if (!res.ok) {
    redirect(`/pratiche/${praticaId}?error=${encodeURIComponent(res.error)}`);
  }
  redirect(`/pratiche/${praticaId}?processata=1`);
}

/**
 * Wrapper per la LISTA pratiche: NON naviga, ritorna l'esito così il client
 * resta sulla lista (stato aggiornato dal refresh) e mostra un toast.
 */
export async function processaPraticaFromListaAction(
  praticaId: string,
): Promise<QuickActionResult> {
  return processaPraticaCore(praticaId);
}

async function firmaPraticaCore(praticaId: string): Promise<QuickActionResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.companyType !== 'AGENZIA') {
    redirect('/dashboard');
  }
  const agenziaId = session.user.companyId!;
  if (await isAgenziaBloccata(agenziaId)) redirect('/blocco-pagamento');

  let accreditiResult: AccreditoEseguito[] = [];
  let feeAgenziaCentFattura = 0;

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
      if (pratica.agenziaAssegnataId !== agenziaId) {
        throw new Error('Pratica non assegnata a questa agenzia');
      }
      if (pratica.stato !== 'PROCESSATA') {
        throw new Error('La pratica deve essere prima processata');
      }

      const now = new Date();
      // Addebito istantaneo: dovuto subito (niente programmazione nel futuro).
      const autoAddebitoAt = now;
      feeAgenziaCentFattura = pratica.feeAgenziaCent;

      await tx.pratica.update({
        where: { id: praticaId },
        data: {
          stato: 'FIRMATA',
          firmaAvvenutaAt: now,
          autoAddebitoAt,
        },
      });

      // Credito wallet broker (proventi pratica) — multi-sede: wallet della sede.
      if (pratica.creditoBrokerCent > 0 && pratica.brokerSedeId) {
        const wallet = await tx.wallet.upsert({
          where: { sedeId: pratica.brokerSedeId },
          update: {},
          create: { sedeId: pratica.brokerSedeId, saldoCent: 0 },
        });
        const nuovoSaldo = wallet.saldoCent + pratica.creditoBrokerCent;
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { saldoCent: nuovoSaldo },
        });
        await tx.transazioneWallet.create({
          data: {
            walletId: wallet.id,
            tipo: 'CREDITO_PRATICA',
            importoCent: pratica.creditoBrokerCent,
            saldoPostCent: nuovoSaldo,
            praticaId: pratica.id,
          },
        });
      }

      // Fee addebito istantaneo (Stripe reale in Fase 5): scheduledAt = now, così
      // il job process-fee-scheduled lo prende al primo giro, senza attese.
      if (pratica.feeAgenziaCent > 0) {
        await tx.feeAddebito.create({
          data: {
            praticaId: pratica.id,
            agenziaId,
            // Multi-sede: l'addebito appartiene alla SEDE che ha lavorato la pratica.
            // Senza questo, /addebiti (scopato per sede) non vedrebbe la riga.
            agenziaSedeId: pratica.agenziaSedeId,
            importoCent: pratica.feeAgenziaCent,
            tipo: 'ADDEBITO_FIRMA',
            stato: 'SCHEDULED',
            scheduledAt: autoAddebitoAt,
          },
        });
      }

      // FASE 13: commissioni affiliazione ai referenti di broker e/o agenzia
      // (skip se referente sospeso o eliminato).
      const accreditOut = await accreditCommissioniAffiliazione(tx, {
        praticaId: pratica.id,
        tipo: pratica.tipo as 'SEMPLICE' | 'MINIVOLTURA',
        numeroVeicoli: pratica.numeroVeicoli,
        brokerId: pratica.brokerId,
        agenziaAssegnataId: pratica.agenziaAssegnataId,
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

  // FT-A: genera la fattura PV verso l'agenzia. ATTESA (era fire-and-forget):
  // il PDF della fattura va allegato alla N8, quindi deve esistere prima di
  // costruire l'allegato. Resta best-effort — la firma è già committata, un
  // errore qui non blocca nulla e la N8 partirà comunque (eventualmente senza
  // allegato).
  await createFatturaPv({
    praticaId,
    agenziaId,
    feeAgenziaCent: feeAgenziaCentFattura,
  }).catch(() => undefined);

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
      // Ripiega sull'email azienda se manca l'admin attivo: N4/N31 non devono
      // sparire in silenzio (coerente con N3).
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
          },
        }).catch(() => undefined);

        await sendNotification({
          tipo: 'N31_VALUTA_AGENZIA',
          target: {
            email: brokerEmail,
            userId: brokerUser?.id ?? null,
            companyId: full.broker.id,
          },
          payload: {
            codicePratica: full.codicePratica ?? '—',
            targa: fullTarga,
            agenziaNome: full.agenziaAssegnata?.ragioneSociale ?? '—',
            nomeBroker,
            praticaUrl: `${env.NEXT_PUBLIC_APP_URL}/pratiche/${praticaId}`,
          },
        }).catch(() => undefined);
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
            },
          },
          fatturaPdf ? { attachments: [fatturaPdf] } : undefined,
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
      }).catch(() => undefined);
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

/** Wrapper per il DETTAGLIO pratica (form action): redirect + toast come prima. */
export async function markFirmaAvvenutaAction(praticaId: string): Promise<void> {
  const res = await firmaPraticaCore(praticaId);
  if (!res.ok) {
    redirect(`/pratiche/${praticaId}?error=${encodeURIComponent(res.error)}`);
  }
  redirect(`/pratiche/${praticaId}?firmata=1`);
}

/** Wrapper per la LISTA pratiche: NON naviga, ritorna l'esito (toast lato client). */
export async function firmaFromListaAction(
  praticaId: string,
): Promise<QuickActionResult> {
  return firmaPraticaCore(praticaId);
}

export async function annullaPraticaAction(praticaId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (session.user.companyType !== 'DEALER') {
    redirect('/dashboard');
  }
  const brokerId = session.user.companyId!;

  let eraBozza = false;

  try {
    await prisma.$transaction(async (tx) => {
      const pratica = await tx.pratica.findUnique({ where: { id: praticaId } });
      if (!pratica) throw new Error('Pratica non trovata');
      if (pratica.brokerId !== brokerId) {
        throw new Error('Non sei il broker di questa pratica');
      }
      if (pratica.stato === 'FIRMATA') {
        throw new Error('Non puoi annullare una pratica già firmata');
      }
      if (pratica.stato === 'ANNULLATA') {
        throw new Error('Pratica già annullata');
      }

      eraBozza = pratica.stato === 'BOZZA';

      const now = new Date();

      await tx.pratica.update({
        where: { id: praticaId },
        data: {
          stato: 'ANNULLATA',
          annullataAt: now,
        },
      });

      await tx.praticaAssegnazione.updateMany({
        where: { praticaId, esito: 'PENDING' },
        data: { esito: 'ASSEGNATA_ALTRO', esitoAt: now },
      });
    });
  } catch (err) {
    redirect(`/pratiche/${praticaId}?error=${encodeURIComponent((err as Error).message)}`);
  }

  // Se la pratica era già accettata, l'agenzia assegnata vede l'annullamento.
  try {
    const p = await prisma.pratica.findUnique({
      where: { id: praticaId },
      select: { agenziaAssegnataId: true, agenziaSedeId: true, codicePratica: true },
    });
    if (p?.agenziaAssegnataId && p.codicePratica) {
      await emitEventoPratica(
        prisma,
        eventoPraticaAnnullata({
          praticaId,
          agenziaId: p.agenziaAssegnataId,
          sedeId: p.agenziaSedeId,
          codicePratica: p.codicePratica,
        }),
      );
    }
  } catch {
    // best-effort
  }

  // Email cliente: pratica annullata. Solo se era stata realmente inviata
  // (mai notificato "avviata" per le bozze -> niente "annullata").
  if (!eraBozza) {
    await notifyClientiAvanzamento(praticaId, 'ANNULLATA').catch(() => undefined);
  }

  revalidatePath('/dashboard');
  revalidatePath('/pratiche');
  revalidatePath(`/pratiche/${praticaId}`);
  redirect(`/pratiche/${praticaId}?annullata=1`);
}

const valutazioneSchema = z.object({
  praticaId: z.string().uuid(),
  stelle: z.coerce.number().int().min(1).max(5),
  note: z.string().trim().max(500).optional(),
});

type ActionResult = { ok: true } | { ok: false; error: string };

export async function submitValutazioneAction(formData: FormData): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: 'Non autenticato' };
  if (session.user.companyType !== 'DEALER') {
    return { ok: false, error: 'Solo i broker possono valutare le agenzie' };
  }
  const dealerId = session.user.companyId;
  if (!dealerId) return { ok: false, error: 'Azienda non associata' };

  const parsed = valutazioneSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join('.')}: ${first.message}` : 'Dati non validi',
    };
  }
  const { praticaId, stelle, note } = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const pratica = await tx.pratica.findUnique({
        where: { id: praticaId },
        include: { valutazione: true },
      });
      if (!pratica) throw new Error('Pratica non trovata');
      if (pratica.brokerId !== dealerId) throw new Error('Non sei il broker di questa pratica');
      if (pratica.stato !== 'FIRMATA') throw new Error('Puoi valutare solo pratiche firmate');
      if (!pratica.agenziaAssegnataId) throw new Error('Nessuna agenzia assegnata');
      if (pratica.valutazione) throw new Error('Hai già valutato questa pratica');

      await tx.valutazione.create({
        data: {
          praticaId,
          agenziaId: pratica.agenziaAssegnataId,
          dealerId,
          // Multi-sede: sede agenzia valutata + sede broker che vota.
          agenziaSedeId: pratica.agenziaSedeId,
          brokerSedeId: pratica.brokerSedeId,
          stelle,
          note: note ?? null,
        },
      });
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath(`/pratiche/${praticaId}`);
  revalidatePath('/dashboard');
  return { ok: true };
}
