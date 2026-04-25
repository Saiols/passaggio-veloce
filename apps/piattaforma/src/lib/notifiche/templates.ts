/**
 * Template MVP per le notifiche email. Testi placeholder: i copy definitivi
 * verranno forniti dal team sales (blocco B7 del piano-implementazione).
 *
 * Ogni template è una funzione pura che riceve un payload tipizzato e ritorna
 * subject + html. Niente accessi DB: i dati necessari arrivano dall'emettitore.
 */

import { formatCurrencyCent, formatDate } from '@/lib/format';

export type N1BrokerInvioPayload = {
  codicePratica: string;
  targa: string | null;
  comune: string | null;
  provincia: string | null;
  numeroAgenzie: number;
  nomeBroker: string;
};

export type N2BrokerAccettataPayload = {
  codicePratica: string;
  targa: string | null;
  agenziaNome: string;
  agenziaCitta: string | null;
  agenziaEmail: string;
  agenziaTelefono: string | null;
  nomeBroker: string;
};

export type N4BrokerFirmaPayload = {
  codicePratica: string;
  targa: string | null;
  agenziaNome: string;
  creditoCent: number;
  saldoCent: number;
  nomeBroker: string;
};

export type N6AgenziaNuovaPayload = {
  codicePratica: string;
  targa: string | null;
  comune: string | null;
  provincia: string | null;
  feeCent: number;
  round: number;
  altreAgenzie: number;
  countdownFineAt: Date | null;
  nomeAgenzia: string;
};

export type N8AgenziaAddebitoPayload = {
  codicePratica: string;
  feeCent: number;
  autoAddebitoAt: Date;
  nomeAgenzia: string;
};

export type N10AdminEscalationPayload = {
  codicePratica: string;
  targa: string | null;
  comune: string | null;
  provincia: string | null;
  tentativi: number;
  brokerRagioneSociale: string;
  brokerEmail: string;
  brokerTelefono: string | null;
};

export type N11BrokerEscalationPayload = {
  codicePratica: string;
  targa: string | null;
  nomeBroker: string;
};

export type N3BrokerSollecitoPayload = {
  codicePratica: string;
  targa: string | null;
  agenziaNome: string;
  nomeBroker: string;
  /** Giorni trascorsi dall'accettazione (o minuti in DEMO) per contestualizzare il testo */
  giorniTrascorsi: number;
};

export type N7AgenziaPromemoriaCountdownPayload = {
  codicePratica: string;
  targa: string | null;
  nomeAgenzia: string;
  feeCent: number;
  /** Data entro cui si aspetta la firma */
  firmaEntroAt: Date;
};

export type NotificaContent = { subject: string; html: string; text: string };

const header = `<div style="background:#0a2540;padding:18px 20px;border-radius:12px 12px 0 0;color:#fff">
  <strong style="font-size:16px;letter-spacing:-0.01em">Passaggio Veloce</strong>
</div>`;

const footer = `<p style="margin:24px 0 0;font-size:11px;color:#64748b;text-align:center">
  Passaggio Veloce &middot; broker digitale per i passaggi di proprietà veicoli
</p>`;

function wrap(body: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto">
    ${header}
    <div style="background:#fff;border:1px solid #e2e8f0;border-top:0;padding:20px;border-radius:0 0 12px 12px">
      ${body}
    </div>
    ${footer}
  </div>`;
}

export function tplN1BrokerInvio(p: N1BrokerInvioPayload): NotificaContent {
  const subject = `Pratica ${p.codicePratica} inviata a ${p.numeroAgenzie} agenzie`;
  const luogo = p.comune ? `${p.comune}${p.provincia ? ` (${p.provincia})` : ''}` : 'zona selezionata';
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `la tua pratica ${p.codicePratica}${p.targa ? ` (${p.targa})` : ''} è stata inviata a ` +
    `${p.numeroAgenzie} agenzie della ${luogo}. Ti notificheremo appena una accetta.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Pratica inviata</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${p.nomeBroker}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la tua pratica <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''}
      è stata inviata a <strong>${p.numeroAgenzie} agenzie</strong> nella zona ${luogo}.
      Ti manderemo un aggiornamento non appena una accetta.
    </p>
    <p style="margin:0;color:#64748b;font-size:12px">Puoi monitorare lo stato dalla tua dashboard.</p>
  `);
  return { subject, html, text };
}

export function tplN2BrokerAccettata(p: N2BrokerAccettataPayload): NotificaContent {
  const subject = `Pratica ${p.codicePratica} accettata da ${p.agenziaNome}`;
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `la pratica ${p.codicePratica}${p.targa ? ` (${p.targa})` : ''} è stata accettata ` +
    `da ${p.agenziaNome}${p.agenziaCitta ? ` (${p.agenziaCitta})` : ''}.\n` +
    `Contatti: ${p.agenziaEmail}${p.agenziaTelefono ? ` · ${p.agenziaTelefono}` : ''}`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Pratica accettata 🎉</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${p.nomeBroker}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      <strong>${p.agenziaNome}</strong> ha accettato la pratica
      <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''}.
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      <strong>Contatti agenzia</strong><br>
      ${p.agenziaCitta ? `${p.agenziaCitta}<br>` : ''}
      Email: <a href="mailto:${p.agenziaEmail}" style="color:#0054a6">${p.agenziaEmail}</a>
      ${p.agenziaTelefono ? `<br>Tel: ${p.agenziaTelefono}` : ''}
    </div>
  `);
  return { subject, html, text };
}

export function tplN4BrokerFirma(p: N4BrokerFirmaPayload): NotificaContent {
  const subject = `Firma avvenuta — pratica ${p.codicePratica} · +${formatCurrencyCent(p.creditoCent)}`;
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `${p.agenziaNome} ha confermato la firma della pratica ${p.codicePratica}. ` +
    `Abbiamo accreditato ${formatCurrencyCent(p.creditoCent)} al tuo wallet. ` +
    `Saldo: ${formatCurrencyCent(p.saldoCent)}.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Firma confermata</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${p.nomeBroker}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      <strong>${p.agenziaNome}</strong> ha confermato la firma della pratica
      <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''}.
    </p>
    <div style="background:#ecfdf5;border:1px solid #16a34a33;border-radius:10px;padding:14px;font-size:14px;color:#0a2540">
      <strong style="color:#16a34a">+${formatCurrencyCent(p.creditoCent)}</strong> accreditati sul tuo wallet.<br>
      Saldo attuale: <strong>${formatCurrencyCent(p.saldoCent)}</strong>
    </div>
  `);
  return { subject, html, text };
}

export function tplN6AgenziaNuova(p: N6AgenziaNuovaPayload): NotificaContent {
  const subject = `Nuova pratica disponibile — ${p.comune ?? 'nuova zona'} · ${formatCurrencyCent(p.feeCent)}`;
  const scadenza = p.countdownFineAt ? formatDate(p.countdownFineAt) : null;
  const text =
    `Ciao ${p.nomeAgenzia},\n` +
    `una nuova pratica (${p.codicePratica}${p.targa ? ` — ${p.targa}` : ''}) ` +
    `è disponibile per la tua agenzia.\n` +
    `Zona: ${p.comune ?? '—'}${p.provincia ? ` (${p.provincia})` : ''}\n` +
    `Fee: ${formatCurrencyCent(p.feeCent)}\n` +
    `Altre agenzie contattate: ${p.altreAgenzie}\n` +
    (scadenza ? `Rispondi entro: ${scadenza}\n` : '') +
    `Accedi alla dashboard per accettare o rifiutare.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Nuova pratica disponibile</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${p.nomeAgenzia}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      una nuova pratica ti è stata assegnata. Altre <strong>${p.altreAgenzie}</strong>
      agenzie sono state contattate — chi accetta per primo vince.
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      <strong>${p.codicePratica}</strong>${p.targa ? ` &middot; ${p.targa}` : ''}<br>
      Zona: ${p.comune ?? '—'}${p.provincia ? ` (${p.provincia})` : ''}<br>
      Fee per te: <strong style="color:#0054a6">${formatCurrencyCent(p.feeCent)}</strong><br>
      Round ${p.round} &middot; ${scadenza ? `rispondi entro ${scadenza}` : 'nessuna scadenza'}
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">Apri la dashboard per accettare o rifiutare.</p>
  `);
  return { subject, html, text };
}

export function tplN8AgenziaAddebito(p: N8AgenziaAddebitoPayload): NotificaContent {
  const subject = `Addebito pratica ${p.codicePratica} programmato per ${formatDate(p.autoAddebitoAt)}`;
  const text =
    `Ciao ${p.nomeAgenzia},\n` +
    `il fee di ${formatCurrencyCent(p.feeCent)} per la pratica ${p.codicePratica} ` +
    `sarà addebitato il ${formatDate(p.autoAddebitoAt)}. ` +
    `In caso di "firma avvenuta" anticipata l'addebito avviene al momento.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Fee pratica programmata</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${p.nomeAgenzia}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      il fee per la pratica <strong>${p.codicePratica}</strong> è stato schedulato.
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      Importo: <strong>${formatCurrencyCent(p.feeCent)}</strong><br>
      Auto-addebito: <strong>${formatDate(p.autoAddebitoAt)}</strong>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">L'integrazione pagamenti SEPA sarà attiva in una fase successiva.</p>
  `);
  return { subject, html, text };
}

export function tplN10AdminEscalation(p: N10AdminEscalationPayload): NotificaContent {
  const subject = `⚠️ Escalation — pratica ${p.codicePratica} senza assegnazione`;
  const text =
    `La pratica ${p.codicePratica} è in escalation dopo ${p.tentativi} tentativi ` +
    `(zona ${p.comune ?? '—'}${p.provincia ? ` ${p.provincia}` : ''}).\n` +
    `Broker: ${p.brokerRagioneSociale} — ${p.brokerEmail}` +
    `${p.brokerTelefono ? ` — ${p.brokerTelefono}` : ''}`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#dc2626">Escalation richiesta</h1>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      La pratica <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''}
      non ha trovato un'agenzia dopo <strong>${p.tentativi} tentativi</strong>.
    </p>
    <div style="background:#fef2f2;border:1px solid #dc262633;border-radius:10px;padding:12px 14px;font-size:13px;color:#0a2540">
      Zona: ${p.comune ?? '—'}${p.provincia ? ` (${p.provincia})` : ''}<br>
      Broker: <strong>${p.brokerRagioneSociale}</strong><br>
      Email: <a href="mailto:${p.brokerEmail}" style="color:#0054a6">${p.brokerEmail}</a>
      ${p.brokerTelefono ? `<br>Tel: ${p.brokerTelefono}` : ''}
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      Apri /admin/escalation per assegnare manualmente o contattare il broker.
    </p>
  `);
  return { subject, html, text };
}

export function tplN3BrokerSollecito(p: N3BrokerSollecitoPayload): NotificaContent {
  const subject = `Sollecito firma — pratica ${p.codicePratica} in attesa`;
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `la pratica ${p.codicePratica}${p.targa ? ` (${p.targa})` : ''} è stata accettata ` +
    `da ${p.agenziaNome} ma la firma non è ancora stata confermata.\n` +
    `Accedi alla dashboard per monitorare lo stato o contattare l'agenzia.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Firma ancora in attesa</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${p.nomeBroker}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la pratica <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''}
      accettata da <strong>${p.agenziaNome}</strong> non risulta ancora firmata.
    </p>
    <p style="margin:0;font-size:12px;color:#64748b">
      Accedi alla dashboard per monitorare lo stato o contattare l'agenzia.
    </p>
  `);
  return { subject, html, text };
}

export function tplN7AgenziaPromemoriaCountdown(p: N7AgenziaPromemoriaCountdownPayload): NotificaContent {
  const subject = `Promemoria firma — pratica ${p.codicePratica} · ${formatCurrencyCent(p.feeCent)}`;
  const text =
    `Ciao ${p.nomeAgenzia},\n` +
    `ti ricordiamo che la pratica ${p.codicePratica}${p.targa ? ` (${p.targa})` : ''} ` +
    `è ancora in attesa di conferma firma.\n` +
    `Fee: ${formatCurrencyCent(p.feeCent)}\n` +
    `Conferma entro: ${formatDate(p.firmaEntroAt)}\n` +
    `Accedi alla dashboard per segnare "firma avvenuta".`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Promemoria: firma in attesa</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${p.nomeAgenzia}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la pratica <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''}
      è ancora in attesa di conferma firma.
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      Fee: <strong style="color:#0054a6">${formatCurrencyCent(p.feeCent)}</strong><br>
      Conferma firma entro: <strong>${formatDate(p.firmaEntroAt)}</strong>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">Apri la dashboard e seleziona "Firma avvenuta".</p>
  `);
  return { subject, html, text };
}

export function tplN11BrokerEscalation(p: N11BrokerEscalationPayload): NotificaContent {
  const subject = `La pratica ${p.codicePratica} è in gestione al nostro team`;
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `la pratica ${p.codicePratica}${p.targa ? ` (${p.targa})` : ''} è presa in carico ` +
    `dal nostro team. Ti contatteremo a breve con un aggiornamento.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Ti stiamo dando una mano</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${p.nomeBroker}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la pratica <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''}
      richiede un nostro intervento manuale. Il team l'ha presa in carico e ti contatteremo a breve.
    </p>
    <p style="margin:0;font-size:12px;color:#64748b">
      Non devi fare nulla: ti aggiorneremo non appena avremo novità.
    </p>
  `);
  return { subject, html, text };
}
