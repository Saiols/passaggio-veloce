import 'server-only';
import { prisma, Prisma } from '@pv/db';
import { env } from '@/env';
import { getEmail, type EmailAttachment } from '@/lib/providers/email';
import { isOptionalTipo, shouldSend } from './preferences';
import { unsubscribeFooterLine, sedeFirmaBlock } from './layout';
import {
  tplN10AdminEscalation,
  tplN11BrokerEscalation,
  tplN12AffiliazioneCommissione,
  tplN13BrokerPraticaProcessata,
  tplN14AccountSospeso,
  tplN15AccountRiattivato,
  tplN16AccountEliminato,
  tplN17BrokerPenaleAddebitata,
  tplN18AgenziaSegnalazioneConfermata,
  tplN19AdminNuovaSegnalazione,
  tplN20AdminRevisioneRichiesta,
  tplN21BrokerRevisioneCompletata,
  tplN22ReferralSignup,
  tplN23ReferralFirstPratica,
  tplN24PayoutAffiliationAvailable,
  tplN25MonthlyAffiliationRecap,
  tplN31ValutaAgenzia,
  tplN40ClienteAvanzamento,
  tplN41AdminNuovaSegnalazione,
  tplN42BrokerSegnalazioneGestita,
  tplN43AgenziaSegnalazioneRespinta,
  tplN1BrokerInvio,
  tplN2BrokerAccettata,
  tplN3BrokerSollecito,
  tplN4BrokerFirma,
  tplN6AgenziaNuova,
  tplN7AgenziaPromemoriaCountdown,
  tplN8AgenziaAddebito,
  tplN9AgenziaAddebitoFallito,
  type N10AdminEscalationPayload,
  type N11BrokerEscalationPayload,
  type N12AffiliazioneCommissionePayload,
  type N13BrokerPraticaProcessataPayload,
  type N14AccountSospesoPayload,
  type N15AccountRiattivatoPayload,
  type N16AccountEliminatoPayload,
  type N17BrokerPenaleAddebitataPayload,
  type N18AgenziaSegnalazioneConfermataPayload,
  type N19AdminNuovaSegnalazionePayload,
  type N20AdminRevisioneRichiestaPayload,
  type N21BrokerRevisioneCompletataPayload,
  type N22ReferralSignupPayload,
  type N23ReferralFirstPraticaPayload,
  type N24PayoutAffiliationAvailablePayload,
  type N25MonthlyAffiliationRecapPayload,
  type N31ValutaAgenziaPayload,
  type N40ClienteAvanzamentoPayload,
  type N41AdminNuovaSegnalazionePayload,
  type N42BrokerSegnalazioneGestitaPayload,
  type N43AgenziaSegnalazioneRespintaPayload,
  type N1BrokerInvioPayload,
  type N2BrokerAccettataPayload,
  type N3BrokerSollecitoPayload,
  type N4BrokerFirmaPayload,
  type N6AgenziaNuovaPayload,
  type N7AgenziaPromemoriaCountdownPayload,
  type N8AgenziaAddebitoPayload,
  type N9AgenziaAddebitoFallitoPayload,
  type NotificaContent,
} from './templates';

type Target = {
  email: string;
  userId?: string | null;
  companyId?: string | null;
};

type SendInput =
  | { tipo: 'N1_BROKER_INVIO_PRATICA'; target: Target; payload: N1BrokerInvioPayload }
  | { tipo: 'N2_BROKER_ACCETTATA'; target: Target; payload: N2BrokerAccettataPayload }
  | { tipo: 'N3_BROKER_SOLLECITO'; target: Target; payload: N3BrokerSollecitoPayload }
  | { tipo: 'N4_BROKER_FIRMA_E_CREDITO'; target: Target; payload: N4BrokerFirmaPayload }
  | { tipo: 'N6_AGENZIA_NUOVA_PRATICA'; target: Target; payload: N6AgenziaNuovaPayload }
  | { tipo: 'N7_AGENZIA_PROMEMORIA_COUNTDOWN'; target: Target; payload: N7AgenziaPromemoriaCountdownPayload }
  | { tipo: 'N8_AGENZIA_ADDEBITO'; target: Target; payload: N8AgenziaAddebitoPayload }
  | { tipo: 'N9_AGENZIA_ADDEBITO_FALLITO'; target: Target; payload: N9AgenziaAddebitoFallitoPayload }
  | { tipo: 'N10_ADMIN_ESCALATION'; target: Target; payload: N10AdminEscalationPayload }
  | { tipo: 'N11_BROKER_ESCALATION'; target: Target; payload: N11BrokerEscalationPayload }
  | {
      tipo: 'N12_AFFILIAZIONE_COMMISSIONE';
      target: Target;
      payload: N12AffiliazioneCommissionePayload;
    }
  | {
      tipo: 'N13_BROKER_PRATICA_PROCESSATA';
      target: Target;
      payload: N13BrokerPraticaProcessataPayload;
    }
  | {
      tipo: 'N14_ACCOUNT_SOSPESO';
      target: Target;
      payload: N14AccountSospesoPayload;
    }
  | {
      tipo: 'N15_ACCOUNT_RIATTIVATO';
      target: Target;
      payload: N15AccountRiattivatoPayload;
    }
  | {
      tipo: 'N16_ACCOUNT_ELIMINATO';
      target: Target;
      payload: N16AccountEliminatoPayload;
    }
  | {
      tipo: 'N17_BROKER_PENALE_ADDEBITATA';
      target: Target;
      payload: N17BrokerPenaleAddebitataPayload;
    }
  | {
      tipo: 'N18_AGENZIA_SEGNALAZIONE_CONFERMATA';
      target: Target;
      payload: N18AgenziaSegnalazioneConfermataPayload;
    }
  | {
      tipo: 'N19_ADMIN_NUOVA_SEGNALAZIONE';
      target: Target;
      payload: N19AdminNuovaSegnalazionePayload;
    }
  | {
      tipo: 'N20_ADMIN_REVISIONE_RICHIESTA';
      target: Target;
      payload: N20AdminRevisioneRichiestaPayload;
    }
  | {
      tipo: 'N21_BROKER_REVISIONE_COMPLETATA';
      target: Target;
      payload: N21BrokerRevisioneCompletataPayload;
    }
  | {
      tipo: 'N22_REFERRAL_SIGNUP';
      target: Target;
      payload: N22ReferralSignupPayload;
    }
  | {
      tipo: 'N23_REFERRAL_FIRST_PRATICA';
      target: Target;
      payload: N23ReferralFirstPraticaPayload;
    }
  | {
      tipo: 'N24_PAYOUT_AFFILIATION_AVAILABLE';
      target: Target;
      payload: N24PayoutAffiliationAvailablePayload;
    }
  | {
      tipo: 'N25_MONTHLY_AFFILIATION_RECAP';
      target: Target;
      payload: N25MonthlyAffiliationRecapPayload;
    }
  | {
      tipo: 'N31_VALUTA_AGENZIA';
      target: Target;
      payload: N31ValutaAgenziaPayload;
    }
  | {
      tipo: 'N40_CLIENTE_AVANZAMENTO';
      target: Target;
      payload: N40ClienteAvanzamentoPayload;
    }
  | {
      tipo: 'N41_ADMIN_NUOVA_SEGNALAZIONE_CREAZIONE';
      target: Target;
      payload: N41AdminNuovaSegnalazionePayload;
    }
  | {
      tipo: 'N42_BROKER_SEGNALAZIONE_GESTITA';
      target: Target;
      payload: N42BrokerSegnalazioneGestitaPayload;
    }
  | {
      tipo: 'N43_AGENZIA_SEGNALAZIONE_RESPINTA';
      target: Target;
      payload: N43AgenziaSegnalazioneRespintaPayload;
    };

function render(input: SendInput): NotificaContent {
  switch (input.tipo) {
    case 'N1_BROKER_INVIO_PRATICA':
      return tplN1BrokerInvio(input.payload);
    case 'N2_BROKER_ACCETTATA':
      return tplN2BrokerAccettata(input.payload);
    case 'N3_BROKER_SOLLECITO':
      return tplN3BrokerSollecito(input.payload);
    case 'N4_BROKER_FIRMA_E_CREDITO':
      return tplN4BrokerFirma(input.payload);
    case 'N6_AGENZIA_NUOVA_PRATICA':
      return tplN6AgenziaNuova(input.payload);
    case 'N7_AGENZIA_PROMEMORIA_COUNTDOWN':
      return tplN7AgenziaPromemoriaCountdown(input.payload);
    case 'N8_AGENZIA_ADDEBITO':
      return tplN8AgenziaAddebito(input.payload);
    case 'N9_AGENZIA_ADDEBITO_FALLITO':
      return tplN9AgenziaAddebitoFallito(input.payload);
    case 'N10_ADMIN_ESCALATION':
      return tplN10AdminEscalation(input.payload);
    case 'N11_BROKER_ESCALATION':
      return tplN11BrokerEscalation(input.payload);
    case 'N12_AFFILIAZIONE_COMMISSIONE':
      return tplN12AffiliazioneCommissione(input.payload);
    case 'N13_BROKER_PRATICA_PROCESSATA':
      return tplN13BrokerPraticaProcessata(input.payload);
    case 'N14_ACCOUNT_SOSPESO':
      return tplN14AccountSospeso(input.payload);
    case 'N15_ACCOUNT_RIATTIVATO':
      return tplN15AccountRiattivato(input.payload);
    case 'N16_ACCOUNT_ELIMINATO':
      return tplN16AccountEliminato(input.payload);
    case 'N17_BROKER_PENALE_ADDEBITATA':
      return tplN17BrokerPenaleAddebitata(input.payload);
    case 'N18_AGENZIA_SEGNALAZIONE_CONFERMATA':
      return tplN18AgenziaSegnalazioneConfermata(input.payload);
    case 'N19_ADMIN_NUOVA_SEGNALAZIONE':
      return tplN19AdminNuovaSegnalazione(input.payload);
    case 'N20_ADMIN_REVISIONE_RICHIESTA':
      return tplN20AdminRevisioneRichiesta(input.payload);
    case 'N21_BROKER_REVISIONE_COMPLETATA':
      return tplN21BrokerRevisioneCompletata(input.payload);
    case 'N22_REFERRAL_SIGNUP':
      return tplN22ReferralSignup(input.payload);
    case 'N23_REFERRAL_FIRST_PRATICA':
      return tplN23ReferralFirstPratica(input.payload);
    case 'N24_PAYOUT_AFFILIATION_AVAILABLE':
      return tplN24PayoutAffiliationAvailable(input.payload);
    case 'N25_MONTHLY_AFFILIATION_RECAP':
      return tplN25MonthlyAffiliationRecap(input.payload);
    case 'N31_VALUTA_AGENZIA':
      return tplN31ValutaAgenzia(input.payload);
    case 'N40_CLIENTE_AVANZAMENTO':
      return tplN40ClienteAvanzamento(input.payload);
    case 'N41_ADMIN_NUOVA_SEGNALAZIONE_CREAZIONE':
      return tplN41AdminNuovaSegnalazione(input.payload);
    case 'N42_BROKER_SEGNALAZIONE_GESTITA':
      return tplN42BrokerSegnalazioneGestita(input.payload);
    case 'N43_AGENZIA_SEGNALAZIONE_RESPINTA':
      return tplN43AgenziaSegnalazioneRespinta(input.payload);
  }
}

/**
 * Invia una notifica via email provider + audit su NotificaInviata.
 * Fire-and-log: errori provider non bloccano il flusso chiamante, ma sono
 * registrati nella riga NotificaInviata (stato=FAILED + errorMessage).
 */
export async function sendNotification(
  input: SendInput,
  opts?: { attachments?: EmailAttachment[]; praticaId?: string },
): Promise<void> {
  const content = render(input);
  const payload: Prisma.InputJsonValue = JSON.parse(JSON.stringify(input.payload));

  // P3: gating preferenze + footer unsubscribe SOLO per le notifiche opzionali.
  // Le transazionali saltano interamente questo blocco (comportamento invariato).
  let html = content.html;
  let text = content.text;
  if (isOptionalTipo(input.tipo) && input.target.userId) {
    const user = await prisma.user.findUnique({
      where: { id: input.target.userId },
      select: { notifPrefs: true, unsubscribeToken: true },
    });
    const prefs = (user?.notifPrefs as Record<string, boolean> | null) ?? null;
    if (!shouldSend(input.tipo, prefs)) {
      await prisma.notificaInviata.create({
        data: {
          tipo: input.tipo,
          canale: 'EMAIL',
          stato: 'SKIPPED',
          userId: input.target.userId,
          companyId: input.target.companyId ?? null,
          destinazione: input.target.email,
          subject: content.subject,
          bodyPreview: content.text.slice(0, 200),
          payload: JSON.parse(JSON.stringify(input.payload)) as Prisma.InputJsonValue,
        },
      });
      return;
    }
    let token = user?.unsubscribeToken ?? null;
    if (!token) {
      token = crypto.randomUUID();
      await prisma.user.update({
        where: { id: input.target.userId },
        data: { unsubscribeToken: token },
      });
    }
    const url = `${env.NEXT_PUBLIC_APP_URL}/unsubscribe?token=${token}`;
    // Inietta il link disiscrizione + preferenze nel footer sostituendo il token segnaposto
    const prefUrl = `${env.NEXT_PUBLIC_APP_URL}/profilo/notifiche`;
    html = html.replace('<!--PV_UNSUB-->', unsubscribeFooterLine(url, prefUrl));
    text = text + `\n\nPer non ricevere più queste email: ${url}\nGestisci le preferenze: ${prefUrl}`;
  }
  // Rimuove il token segnaposto per le notifiche non-opzionali (o se già sostituito, è un no-op)
  html = html.replace('<!--PV_UNSUB-->', '');

  // Blocco "Sede della firma": per le notifiche legate a una pratica GIÀ ACCETTATA
  // da una sede, inietta a TUTTE le figure coinvolte l'indirizzo dove avverrà la
  // firma (segnaposto <!--PV_SEDE--> nel layout). Caricamento solo se il call-site
  // passa praticaId: le email non legate a pratiche non pagano la query. Gate:
  // agenziaAssegnataId != null ⇔ accettata (valorizzato con agenziaSedeId
  // all'accettazione). Preferisce la SEDE che ha accettato, fallback madre.
  if (opts?.praticaId) {
    const pr = await prisma.pratica.findUnique({
      where: { id: opts.praticaId },
      select: {
        agenziaAssegnataId: true,
        agenziaSede: {
          select: { nome: true, indirizzo: true, civico: true, cap: true, citta: true, provincia: true },
        },
        agenziaAssegnata: {
          select: { ragioneSociale: true, indirizzo: true, civico: true, cap: true, citta: true, provincia: true },
        },
      },
    });
    if (pr?.agenziaAssegnataId) {
      const s = pr.agenziaSede;
      const m = pr.agenziaAssegnata;
      const sede = s
        ? { nome: s.nome, indirizzo: s.indirizzo, civico: s.civico, cap: s.cap, citta: s.citta, provincia: s.provincia }
        : m
          ? { nome: m.ragioneSociale, indirizzo: m.indirizzo, civico: m.civico, cap: m.cap, citta: m.citta, provincia: m.provincia }
          : null;
      if (sede) {
        const blocco = sedeFirmaBlock(sede);
        html = html.replace('<!--PV_SEDE-->', blocco.html);
        text = text + blocco.text;
      }
    }
  }
  // Rimuove il segnaposto sede se non sostituito (no-op se già sostituito).
  html = html.replace('<!--PV_SEDE-->', '');

  const record = await prisma.notificaInviata.create({
    data: {
      tipo: input.tipo,
      canale: 'EMAIL',
      stato: 'SCHEDULED',
      userId: input.target.userId ?? null,
      companyId: input.target.companyId ?? null,
      destinazione: input.target.email,
      subject: content.subject,
      bodyPreview: content.text.slice(0, 200),
      payload,
    },
  });

  try {
    const email = getEmail();
    const result = await email.send({
      to: input.target.email,
      from: env.EMAIL_FROM,
      subject: content.subject,
      html,
      text,
      tag: input.tipo,
      ...(opts?.attachments?.length ? { attachments: opts.attachments } : {}),
    });

    if (result.ok) {
      await prisma.notificaInviata.update({
        where: { id: record.id },
        data: {
          stato: 'SENT',
          sentAt: new Date(),
          providerRef: result.messageId,
        },
      });
    } else {
      await prisma.notificaInviata.update({
        where: { id: record.id },
        data: {
          stato: 'FAILED',
          failedAt: new Date(),
          errorMessage: result.error,
        },
      });
    }
  } catch (err) {
    await prisma.notificaInviata.update({
      where: { id: record.id },
      data: {
        stato: 'FAILED',
        failedAt: new Date(),
        errorMessage: (err as Error).message.slice(0, 500),
      },
    });
  }
}

/**
 * Invia N notifiche in parallelo (batch per assegnazioni round). Non
 * propaga errori di singole invii: ognuna è tracciata in NotificaInviata.
 */
export async function sendNotifications(inputs: readonly SendInput[]): Promise<void> {
  await Promise.all(inputs.map((i) => sendNotification(i).catch(() => undefined)));
}

/**
 * Recupera le email degli admin piattaforma attivi.
 * Usata da notifiche tipo N10 (escalation).
 */
export async function getAdminEmails(): Promise<{ email: string; userId: string }[]> {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN_PIATTAFORMA', status: 'ACTIVE', deletedAt: null },
    select: { id: true, email: true },
  });
  return admins.map((a) => ({ email: a.email, userId: a.id }));
}
