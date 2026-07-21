/**
 * Template MVP per le notifiche email. Testi placeholder: i copy definitivi
 * verranno forniti dal team sales (blocco B7 del piano-implementazione).
 *
 * Ogni template è una funzione pura che riceve un payload tipizzato e ritorna
 * subject + html. Niente accessi DB: i dati necessari arrivano dall'emettitore.
 */

import { formatCurrencyCent, formatDate } from '@/lib/format';
import { emailLayout, ctaButton } from './layout';
import { escapeHtml } from '@/lib/escape-html';
import { siteUrl } from '@/lib/seo/brand';

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
  agenziaIndirizzo: string | null;
  agenziaCap: string | null;
  agenziaCitta: string | null;
  agenziaProvincia: string | null;
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
  /** Firma attestata dal Gestore (Termini art. 11), non segnalata dall'agenzia. */
  attestataDaPv?: boolean;
  /**
   * Data dell'attestazione (Termini art. 11): "ne dà evidenza a Broker e
   * Agenzia comunicando loro che la firma è stata attestata dal Gestore e
   * la relativa data". È anche il punto da cui decorre la finestra di
   * contestazione di 15 giorni.
   */
  attestataDaPvAt?: Date | null;
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
  /** Firma attestata dal Gestore (Termini art. 11), non segnalata dall'agenzia. */
  attestataDaPv?: boolean;
  /** Data dell'attestazione (Termini art. 11) — v. N4BrokerFirmaPayload. */
  attestataDaPvAt?: Date | null;
};

export type N9AgenziaAddebitoFallitoPayload = {
  nomeAgenzia: string;
  rimedioUrl: string;
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

export type N52BrokerZonaNonCopertaPayload = {
  codicePratica: string;
  targa: string | null;
  nomeBroker: string;
  /** Raggio massimo configurato (km) raggiunto senza nessuna agenzia disponibile */
  raggioMaxKm: number;
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

export type N13BrokerPraticaProcessataPayload = {
  codicePratica: string;
  targa: string | null;
  agenziaNome: string;
  nomeBroker: string;
};

export type ClienteAvanzamentoStato =
  | 'AVVIATA' | 'PRESA_IN_CARICO' | 'PRONTA_FIRMA' | 'COMPLETATA' | 'ANNULLATA' | 'RIMESSA_IN_CIRCOLO';
export type ClienteAvanzamentoRuolo = 'ACQUIRENTE' | 'VENDITORE';
export type N40ClienteAvanzamentoPayload = {
  codicePratica: string;
  veicoloDescrizione: string | null;
  nomeDestinatario: string;
  ruolo: ClienteAvanzamentoRuolo;
  stato: ClienteAvanzamentoStato;
  // Agenzia assegnata (presente da PRESA_IN_CARICO in poi): serve a indicare al
  // cliente dove recarsi di persona con i documenti originali.
  agenziaNome?: string | null;
  agenziaIndirizzo?: string | null;
  agenziaCap?: string | null;
  agenziaCitta?: string | null;
  agenziaProvincia?: string | null;
  // Ragione sociale del broker che ci ha trasmesso i dati. Art. 14 GDPR: alla
  // prima comunicazione dobbiamo dire all'interessato DA CHI li abbiamo
  // ricevuti — è ciò che distingue questa informativa da quella dell'art. 13.
  nomeBroker?: string | null;
};

export type N14AccountSospesoPayload = {
  nomeUtente: string;
  ragioneSociale: string;
  motivo?: string | null;
};

export type N15AccountRiattivatoPayload = {
  nomeUtente: string;
  ragioneSociale: string;
  /** Nota admin opzionale sul motivo di riattivazione (A7). */
  motivo?: string | null;
};

export type N16AccountEliminatoPayload = {
  nomeUtente: string;
  ragioneSociale: string;
};

/**
 * Clausola 12.3-bis dei Termini: sospensione della SINGOLA utenza (distinta
 * dalla sospensione dell'intera azienda, N14). Il motivo è sempre presente
 * (obbligatorio in `suspendUserAction`), a differenza di N14 dov'è opzionale.
 */
export type N45UtenteSospesoPayload = {
  nomeUtente: string;
  ragioneSociale: string;
  motivo: string;
};

export type N17BrokerPenaleAddebitataPayload = {
  nomeBroker: string;
  codicePratica: string;
  targa: string | null;
  tipoSegnalazione: 'FERMO_AMMINISTRATIVO' | 'IPOTECA' | 'DOCUMENTO_NON_VALIDO' | 'ALTRO';
  importoPenaleCent: number;
  /** Targhe dei veicoli su cui è calcolata la penale (€25 ciascuno). */
  veicoliSegnalati: string[];
  saldoWalletCent: number;
};

export type N18AgenziaSegnalazioneConfermataPayload = {
  nomeAgenzia: string;
  codicePratica: string;
  targa: string | null;
  tipoSegnalazione: 'FERMO_AMMINISTRATIVO' | 'IPOTECA' | 'DOCUMENTO_NON_VALIDO' | 'ALTRO';
};

export type N43AgenziaSegnalazioneRespintaPayload = {
  nomeAgenzia: string;
  codicePratica: string;
  targa: string | null;
  tipoSegnalazione: 'FERMO_AMMINISTRATIVO' | 'IPOTECA' | 'DOCUMENTO_NON_VALIDO' | 'ALTRO';
  /** Motivo del respingimento inserito dall'admin platform. */
  motivo: string;
};

/**
 * Controparte del broker per N43: la sua pratica era comparsa come "Segnalata /
 * in revisione" (stato-extra.ts) e senza questa notifica sparisce nel silenzio
 * al respingimento. Volutamente NON riporta `motivo` né la nota dell'agenzia:
 * contengono valutazioni sull'operato altrui, il broker deve sapere solo
 * l'esito (nessuna penale, pratica prosegue).
 */
export type N44BrokerSegnalazioneRespintaPayload = {
  nomeBroker: string;
  codicePratica: string;
  targa: string | null;
  tipoSegnalazione: 'FERMO_AMMINISTRATIVO' | 'IPOTECA' | 'DOCUMENTO_NON_VALIDO' | 'ALTRO';
};

export type N19AdminNuovaSegnalazionePayload = {
  codicePratica: string;
  targa: string | null;
  brokerRagioneSociale: string;
  agenziaRagioneSociale: string;
  tipoSegnalazione: 'FERMO_AMMINISTRATIVO' | 'IPOTECA' | 'DOCUMENTO_NON_VALIDO' | 'ALTRO';
  notaSegnalazione: string | null;
};

export type N20AdminRevisioneRichiestaPayload = {
  praticaId: string;
  codicePratica: string;
  motivo: 'DOCUMENTO_NON_STANDARD' | 'CASO_NON_PREVISTO_DA_SCHEMA' | 'RICHIESTA_BROKER';
  note: string;
  brokerUserId: string;
};

export type N21BrokerRevisioneCompletataPayload = {
  codicePratica: string;
  nomeBroker: string;
  esito: 'RISOLTA' | 'ANNULLATA';
  noteEsito: string;
};

export type N12AffiliazioneCommissionePayload = {
  codicePratica: string;
  targa: string | null;
  nomeReferente: string;
  /** Ragione sociale del referral (chi ha lavorato la pratica) */
  referralRagioneSociale: string;
  /** REFERENTE_BROKER | REFERENTE_AGENZIA — utile per personalizzare il copy */
  tipoReferente: 'REFERENTE_BROKER' | 'REFERENTE_AGENZIA';
  importoAccreditatoCent: number;
  saldoWalletCent: number;
};

export type N41AdminNuovaSegnalazionePayload = {
  segnalazioneId: string;
  ragioneSociale: string;
  step: number;
  tipo: string;
  estratto: string;
};

export type N42BrokerSegnalazioneGestitaPayload = {
  nota: string;
  nomeBroker: string;
};

// ════════════════════════════════════════════════════════
// Ciclo di vita visura camerale (clausola 8 dei Termini, 180 giorni)
// ════════════════════════════════════════════════════════

/**
 * `visuraData` (ISO yyyy-mm-dd, data di emissione della visura corrente) NON
 * si usa nel testo dell'email: è la CHIAVE DI DEDUPLICAZIONE del cron, che la
 * rilegge da `NotificaInviata.payload` (`payload->>'visuraData'`, colonna
 * jsonb). Sta nel payload perché è l'unico posto che `sendNotification`
 * persiste — non c'è un'altra tabella dove il cron possa cercare "ho già
 * avvisato per QUESTA visura?". Ancorando la chiave alla data della visura
 * (non a un contatore o a "oggi"), un nuovo caricamento cambia la data e
 * quindi la chiave, e il ciclo di avvisi riparte da solo per la nuova visura.
 * Toglierla = il cron non ha più modo di distinguere "già avvisato" da
 * "nuova scadenza": rispedisce le stesse email ogni giorno, per sempre.
 */
export type N46VisuraInScadenzaPayload = {
  nomeAzienda: string;
  companyType: 'DEALER' | 'AGENZIA';
  /** Finestra di preavviso: 1-5 giorni alla scadenza (180 gg dall'emissione). */
  giorniRimanenti: number;
  rimedioUrl: string;
  visuraData: string;
};

/** V. commento su `visuraData` in `N46VisuraInScadenzaPayload`: stessa chiave di deduplicazione cron. */
export type N47VisuraScadutaPayload = {
  nomeAzienda: string;
  companyType: 'DEALER' | 'AGENZIA';
  rimedioUrl: string;
  visuraData: string;
  /** Giorni trascorsi oltre i 180 di validità (visura scaduta da...). */
  giorniTrascorsi: number;
};

/** V. commento su `visuraData` in `N46VisuraInScadenzaPayload`: stessa chiave di deduplicazione cron. */
export type N48BrokerPraticaCongelataPayload = {
  nomeBroker: string;
  nomeAgenzia: string;
  praticaId: string;
  praticaUrl: string;
  visuraData: string;
};

/**
 * A evento (un aggiornamento visura con ATECO non ammesso), non ciclica come
 * N46-N48: niente `visuraData`, non serve una chiave di deduplicazione cron.
 */
export type N49AdminAtecoNonIdoneoPayload = {
  nomeAzienda: string;
  companyType: 'DEALER' | 'AGENZIA';
  atecoCodes: string;
  adminUrl: string;
};

export type NotificaContent = { subject: string; html: string; text: string };

// Wrapper unificato: delega al layout istituzionale condiviso.
// Tutti i ~28 template ottengono automaticamente il nuovo look senza modifiche.
function wrap(body: string): string {
  return emailLayout(body);
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
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeBroker)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la tua pratica <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''}
      è stata inviata a <strong>${p.numeroAgenzie} agenzie</strong> nella zona ${escapeHtml(luogo)}.
      Ti manderemo un aggiornamento non appena una accetta.
    </p>
    <p style="margin:0;color:#64748b;font-size:12px">Puoi monitorare lo stato dalla tua dashboard.</p>
  `);
  return { subject, html, text };
}

export function tplN2BrokerAccettata(p: N2BrokerAccettataPayload): NotificaContent {
  const subject = `Pratica ${p.codicePratica} accettata da ${p.agenziaNome}`;
  // Riga città: "CAP Città (PROV)" senza parti vuote.
  const cittaRiga = [
    p.agenziaCap,
    p.agenziaCitta,
    p.agenziaProvincia ? `(${p.agenziaProvincia})` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const indirizzoCompleto = [p.agenziaIndirizzo, cittaRiga].filter(Boolean).join(', ');
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `la pratica ${p.codicePratica}${p.targa ? ` (${p.targa})` : ''} è stata accettata ` +
    `da ${p.agenziaNome}${p.agenziaCitta ? ` (${p.agenziaCitta})` : ''}.\n` +
    `${indirizzoCompleto ? `Indirizzo: ${indirizzoCompleto}\n` : ''}` +
    `Contatti: ${p.agenziaEmail}${p.agenziaTelefono ? ` · ${p.agenziaTelefono}` : ''}`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Pratica accettata 🎉</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeBroker)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      <strong>${escapeHtml(p.agenziaNome)}</strong> ha accettato la pratica
      <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''}.
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      <strong>Contatti agenzia</strong><br>
      ${p.agenziaIndirizzo ? `${escapeHtml(p.agenziaIndirizzo)}<br>` : ''}
      ${cittaRiga ? `${escapeHtml(cittaRiga)}<br>` : ''}
      Email: <a href="mailto:${escapeHtml(p.agenziaEmail)}" style="color:#0054a6">${escapeHtml(p.agenziaEmail)}</a>
      ${p.agenziaTelefono ? `<br>Tel: ${escapeHtml(p.agenziaTelefono)}` : ''}
    </div>
  `);
  return { subject, html, text };
}

export function tplN4BrokerFirma(p: N4BrokerFirmaPayload): NotificaContent {
  const subject = `Firma avvenuta — pratica ${p.codicePratica} · +${formatCurrencyCent(p.creditoCent)}`;
  // Se la firma l'abbiamo attestata noi (Termini art. 11), dire che "l'agenzia
  // ha confermato" è falso: la frase va sostituita, non integrata. Niente
  // motivazione interna: resta visibile solo in area admin.
  //
  // La data va riportata quando presente: l'art. 11 promette che la
  // comunicazione dà evidenza "che la firma è stata attestata dal Gestore e
  // la relativa data" — è anche il punto da cui decorrono i 15 giorni per
  // contestare.
  const dataAttestazioneText = p.attestataDaPvAt ? ` in data ${formatDate(p.attestataDaPvAt)}` : '';
  const chiHaConfermatoText = p.attestataDaPv
    ? `Il team Passaggio Veloce ha registrato la firma della pratica ${p.codicePratica}${dataAttestazioneText}, avendone avuto conferma.`
    : `${p.agenziaNome} ha confermato la firma della pratica ${p.codicePratica}.`;
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `${chiHaConfermatoText} ` +
    `Abbiamo accreditato ${formatCurrencyCent(p.creditoCent)} al tuo wallet. ` +
    `Saldo: ${formatCurrencyCent(p.saldoCent)}.`;
  const dataAttestazioneHtml = p.attestataDaPvAt
    ? ` in data <strong>${formatDate(p.attestataDaPvAt)}</strong>`
    : '';
  const chiHaConfermatoHtml = p.attestataDaPv
    ? `Il <strong>team Passaggio Veloce</strong> ha registrato la firma della pratica <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''}${dataAttestazioneHtml}, avendone avuto conferma.`
    : `<strong>${escapeHtml(p.agenziaNome)}</strong> ha confermato la firma della pratica <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''}.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Firma confermata</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeBroker)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">${chiHaConfermatoHtml}</p>
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
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeAgenzia)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      una nuova pratica ti è stata assegnata. Altre <strong>${p.altreAgenzie}</strong>
      agenzie sono state contattate — chi accetta per primo vince.
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      <strong>${p.codicePratica}</strong>${p.targa ? ` &middot; ${p.targa}` : ''}<br>
      Zona: ${escapeHtml(p.comune ?? '—')}${p.provincia ? ` (${escapeHtml(p.provincia)})` : ''}<br>
      Fee per te: <strong style="color:#0054a6">${formatCurrencyCent(p.feeCent)}</strong><br>
      Round ${p.round} &middot; ${scadenza ? `rispondi entro ${scadenza}` : 'nessuna scadenza'}
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">Apri la dashboard per accettare o rifiutare.</p>
  `);
  return { subject, html, text };
}

export function tplN8AgenziaAddebito(p: N8AgenziaAddebitoPayload): NotificaContent {
  const subject = `Addebito pratica ${p.codicePratica} programmato per ${formatDate(p.autoAddebitoAt)}`;
  // Se la firma è stata attestata dal Gestore (Termini art. 11) anziché
  // segnalata dall'agenzia, questa deve sapere perché viene addebitata e
  // che può contestare — senza esporre la motivazione interna. La data va
  // riportata quando presente: è il punto da cui decorrono i 15 giorni.
  const dataAttestazioneN8Text = p.attestataDaPvAt ? ` il ${formatDate(p.attestataDaPvAt)}` : '';
  const attestazioneText = p.attestataDaPv
    ? `\nLa firma è stata registrata dal team Passaggio Veloce${dataAttestazioneN8Text} sulla base delle informazioni in nostro possesso (v. clausola 11 dei Termini). Se ritieni che si tratti di un errore, puoi contestarlo entro 15 giorni scrivendo all'assistenza.`
    : '';
  const text =
    `Ciao ${p.nomeAgenzia},\n` +
    `il fee di ${formatCurrencyCent(p.feeCent)} per la pratica ${p.codicePratica} ` +
    `sarà addebitato il ${formatDate(p.autoAddebitoAt)}. ` +
    `In caso di "firma avvenuta" anticipata l'addebito avviene al momento.` +
    attestazioneText;
  const dataAttestazioneN8Html = p.attestataDaPvAt
    ? ` il <strong>${formatDate(p.attestataDaPvAt)}</strong>`
    : '';
  const attestazioneHtml = p.attestataDaPv
    ? `<p style="margin:16px 0 0;font-size:12px;color:#64748b">La firma è stata registrata dal <strong>team Passaggio Veloce</strong>${dataAttestazioneN8Html} sulla base delle informazioni in nostro possesso (v. clausola 11 dei Termini). Se ritieni che si tratti di un errore, puoi contestarlo entro 15 giorni scrivendo all&apos;assistenza.</p>`
    : '';
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Fee pratica programmata</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeAgenzia)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      il fee per la pratica <strong>${p.codicePratica}</strong> è stato schedulato.
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      Importo: <strong>${formatCurrencyCent(p.feeCent)}</strong><br>
      Auto-addebito: <strong>${formatDate(p.autoAddebitoAt)}</strong>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">L'integrazione pagamenti SEPA sarà attiva in una fase successiva.</p>
    ${attestazioneHtml}
  `);
  return { subject, html, text };
}

export function tplN9AgenziaAddebitoFallito(p: N9AgenziaAddebitoFallitoPayload): NotificaContent {
  const subject = 'Addebito automatico non riuscito — operatività limitata';
  const text =
    `Ciao ${p.nomeAgenzia},\n` +
    `non ha funzionato l'addebito automatico della fee. L'accesso alla Piattaforma resta attivo, ` +
    `ma la tua operatività è al momento limitata: non riceverai nuove pratiche e non puoi lavorare ` +
    `quelle in corso fino alla regolarizzazione.\n` +
    `Aggiorna l'IBAN inserito nella piattaforma (o richiedi un nuovo tentativo se hai già sistemato con la banca). ` +
    `Lo sblocco avviene automaticamente una volta regolarizzato.\n` +
    `Vai a: ${p.rimedioUrl}`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#dc2626">Addebito automatico non riuscito</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeAgenzia)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      non ha funzionato l&apos;addebito automatico della fee. <strong>L&apos;accesso alla Piattaforma resta attivo</strong>,
      ma la tua operatività è al momento limitata: non riceverai nuove pratiche e non potrai lavorare
      quelle in corso fino alla regolarizzazione.
    </p>
    ${ctaButton(p.rimedioUrl, 'Aggiorna IBAN / Riprova')}
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      Lo sblocco avviene automaticamente una volta che l&apos;addebito sarà regolarizzato.
    </p>
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
      Zona: ${escapeHtml(p.comune ?? '—')}${p.provincia ? ` (${escapeHtml(p.provincia)})` : ''}<br>
      Broker: <strong>${escapeHtml(p.brokerRagioneSociale)}</strong><br>
      Email: <a href="mailto:${escapeHtml(p.brokerEmail)}" style="color:#0054a6">${escapeHtml(p.brokerEmail)}</a>
      ${p.brokerTelefono ? `<br>Tel: ${escapeHtml(p.brokerTelefono)}` : ''}
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
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeBroker)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la pratica <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''}
      accettata da <strong>${escapeHtml(p.agenziaNome)}</strong> non risulta ancora firmata.
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
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeAgenzia)}</strong>,</p>
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

export function tplN12AffiliazioneCommissione(
  p: N12AffiliazioneCommissionePayload,
): NotificaContent {
  const ruoloLabel =
    p.tipoReferente === 'REFERENTE_BROKER' ? 'broker' : 'agenzia';
  const subject = `+${formatCurrencyCent(p.importoAccreditatoCent)} da affiliazione — ${p.referralRagioneSociale}`;
  const text =
    `Ciao ${p.nomeReferente},\n` +
    `la pratica ${p.codicePratica}${p.targa ? ` (${p.targa})` : ''} è stata firmata.\n` +
    `Hai guadagnato ${formatCurrencyCent(p.importoAccreditatoCent)} ` +
    `dal tuo referral ${ruoloLabel} "${p.referralRagioneSociale}".\n` +
    `Saldo wallet attuale: ${formatCurrencyCent(p.saldoWalletCent)}.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">+${formatCurrencyCent(p.importoAccreditatoCent)} da affiliazione 🎉</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeReferente)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      una pratica completata da <strong>${escapeHtml(p.referralRagioneSociale)}</strong> (tuo referral
      ${ruoloLabel}) ti ha generato una commissione di affiliazione.
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      Pratica: <strong>${p.codicePratica}</strong>${p.targa ? ` &middot; ${p.targa}` : ''}<br>
      Accreditato: <strong style="color:#16a34a">+${formatCurrencyCent(p.importoAccreditatoCent)}</strong><br>
      Saldo wallet: <strong>${formatCurrencyCent(p.saldoWalletCent)}</strong>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      Continua a invitare colleghi: la commissione si attiva automaticamente ad ogni firma.
    </p>
  `);
  return { subject, html, text };
}

export function tplN13BrokerPraticaProcessata(
  p: N13BrokerPraticaProcessataPayload,
): NotificaContent {
  const subject = `Pratica ${p.codicePratica} processata — manca solo la firma`;
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `${p.agenziaNome} ha completato la lavorazione della pratica ${p.codicePratica}` +
    `${p.targa ? ` (${p.targa})` : ''}.\n` +
    `Manca solo la firma del cliente per concludere il passaggio.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Pratica processata</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeBroker)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      <strong>${escapeHtml(p.agenziaNome)}</strong> ha completato la lavorazione della pratica
      <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''}.
    </p>
    <div style="background:#fef3c7;border:1px solid #f59e0b33;border-radius:10px;padding:12px 14px;font-size:13px;color:#0a2540">
      Documenti pronti, attesa firma del cliente. Riceverai un'altra notifica al completamento del passaggio.
    </div>
  `);
  return { subject, html, text };
}

export function tplN40ClienteAvanzamento(p: N40ClienteAvanzamentoPayload): NotificaContent {
  // Frammento veicolo (raw, usato nella prosa). La targa è alfanumerica;
  // l'escape avviene a valle quando la prosa entra nell'HTML.
  const veic = p.veicoloDescrizione ? ` del veicolo ${p.veicoloDescrizione}` : '';
  const operazione = p.ruolo === 'ACQUIRENTE' ? "l'acquisto" : 'la vendita';

  const M: Record<ClienteAvanzamentoStato, { titolo: string; subject: string; corpo: string }> = {
    AVVIATA: {
      titolo: 'Pratica avviata',
      subject: `Pratica ${p.codicePratica} avviata`,
      corpo: `abbiamo avviato la pratica per ${operazione}${veic}. Ti terremo aggiornato sui prossimi passaggi.`,
    },
    PRESA_IN_CARICO: {
      titolo: 'Pratica presa in carico',
      subject: `Pratica ${p.codicePratica} presa in carico`,
      corpo: `un'agenzia partner ha preso in carico la pratica${veic} e si occuperà degli adempimenti.`,
    },
    PRONTA_FIRMA: {
      titolo: 'Documenti pronti per la firma',
      subject: `Pratica ${p.codicePratica}: documenti pronti per la firma`,
      corpo: `i documenti della pratica${veic} sono pronti: a breve verrai contattato per la firma.`,
    },
    COMPLETATA: {
      titolo: 'Passaggio di proprietà completato',
      subject: `Pratica ${p.codicePratica} completata`,
      corpo: `il passaggio di proprietà${veic} è stato completato con successo. Grazie per aver scelto Passaggio Veloce.`,
    },
    ANNULLATA: {
      titolo: 'Pratica annullata',
      subject: `Pratica ${p.codicePratica} annullata`,
      corpo: `la pratica${veic} è stata annullata. Per maggiori informazioni puoi contattare il tuo riferimento.`,
    },
    RIMESSA_IN_CIRCOLO: {
      titolo: 'Aggiornamento sulla tua pratica',
      subject: `Pratica ${p.codicePratica}: aggiornamento`,
      corpo: `stiamo affidando la pratica${veic} a una nuova agenzia della zona per completare ${operazione}. Ti aggiorniamo appena viene presa in carico.`,
    },
  };

  const m = M[p.stato];

  // Indirizzo agenzia/sede:
  //  - PRESA_IN_CARICO / PRONTA_FIRMA → DOVE RECARSI (con gli originali);
  //  - COMPLETATA → la SEDE PRESSO CUI si è firmato (deve restare visibile
  //    nell'email finale di passaggio completato).
  const isCompletata = p.stato === 'COMPLETATA';
  const mostraAgenzia =
    p.stato === 'PRESA_IN_CARICO' || p.stato === 'PRONTA_FIRMA' || isCompletata;
  const cittaRiga = [
    p.agenziaCap,
    p.agenziaCitta,
    p.agenziaProvincia ? `(${p.agenziaProvincia})` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const hasIndirizzo = mostraAgenzia && (!!p.agenziaIndirizzo || !!cittaRiga);
  const indirizzoCompleto = [p.agenziaIndirizzo, cittaRiga].filter(Boolean).join(', ');

  const agenziaText = hasIndirizzo
    ? isCompletata
      ? `\nSede della firma${p.agenziaNome ? `: ${p.agenziaNome}` : ''} — ${indirizzoCompleto}.`
      : `\nRecati in agenzia con i documenti originali` +
        `${p.agenziaNome ? ` presso ${p.agenziaNome}` : ''}, all'indirizzo: ${indirizzoCompleto}.`
    : '';
  const agenziaHtml = hasIndirizzo
    ? `
    <div style="margin-top:12px;background:${isCompletata ? '#f0f9ff' : '#fff7ed'};border:1px solid ${isCompletata ? '#0ea5e933' : '#f59e0b33'};border-radius:10px;padding:12px 14px;font-size:13px;color:#0a2540">
      <strong>${isCompletata ? 'Sede della firma' : 'Dove recarti'}</strong><br>
      ${p.agenziaNome ? `${escapeHtml(p.agenziaNome)}<br>` : ''}
      ${p.agenziaIndirizzo ? `${escapeHtml(p.agenziaIndirizzo)}<br>` : ''}
      ${cittaRiga ? `${escapeHtml(cittaRiga)}<br>` : ''}
      ${isCompletata
        ? 'Sede presso cui è avvenuta la firma del passaggio.'
        : 'Porta con te i <strong>documenti originali</strong>.'}
    </div>`
    : '';

  // Informativa art. 14 GDPR. Su AVVIATA — la PRIMA comunicazione che il
  // cliente riceve da noi — diciamo anche da chi abbiamo avuto i suoi dati.
  const privacyUrl = siteUrl('/privacy/clienti');
  const fonte =
    p.stato === 'AVVIATA' && p.nomeBroker
      ? ` I tuoi dati ci sono stati trasmessi da ${p.nomeBroker} per gestire questa pratica.`
      : '';
  const privacyText =
    `\n\nPassaggio Veloce S.r.l. tratta i tuoi dati per gestire la pratica.${fonte}` +
    ` Qui trovi chi siamo e quali diritti hai: ${privacyUrl}`;
  const privacyHtml = `
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      Passaggio Veloce S.r.l. tratta i tuoi dati per gestire la pratica.${
        fonte ? escapeHtml(fonte) : ''
      }
      Qui trovi <a href="${privacyUrl}" style="color:#0a2540">chi siamo e quali diritti hai</a>.
    </p>`;

  const text =
    `Ciao ${p.nomeDestinatario},\n` +
    `${m.corpo}\n` +
    `Numero pratica: ${p.codicePratica}.` +
    agenziaText +
    privacyText;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">${escapeHtml(m.titolo)}</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeDestinatario)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">${escapeHtml(m.corpo)}</p>
    <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;font-size:13px;color:#0a2540">
      Numero pratica: <strong>${escapeHtml(p.codicePratica)}</strong>
    </div>${agenziaHtml}${privacyHtml}
  `);
  return { subject: m.subject, html, text };
}

export function tplN14AccountSospeso(
  p: N14AccountSospesoPayload,
): NotificaContent {
  const subject = `Account ${p.ragioneSociale} sospeso`;
  const text =
    `Ciao ${p.nomeUtente},\n` +
    `il tuo account Passaggio Veloce associato a ${p.ragioneSociale} ` +
    `e' stato sospeso da un amministratore.\n` +
    (p.motivo ? `Motivo: ${p.motivo}\n` : '') +
    `Non puoi accedere alla piattaforma fino alla riattivazione. ` +
    `Per chiarimenti contatta assistenza@passaggioveloce.it.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#dc2626">Account sospeso</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeUtente)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      il tuo account associato a <strong>${escapeHtml(p.ragioneSociale)}</strong> e&apos;
      stato sospeso da un amministratore. Non puoi accedere alla piattaforma
      fino alla riattivazione.
    </p>
    ${p.motivo ? `<div style="background:#fef2f2;border:1px solid #dc262633;border-radius:10px;padding:12px 14px;font-size:13px;color:#0a2540"><strong>Motivo:</strong> ${escapeHtml(p.motivo)}</div>` : ''}
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      Per chiarimenti scrivi a <a href="mailto:assistenza@passaggioveloce.it">assistenza@passaggioveloce.it</a>.
    </p>
  `);
  return { subject, html, text };
}

export function tplN15AccountRiattivato(
  p: N15AccountRiattivatoPayload,
): NotificaContent {
  const subject = `Account ${p.ragioneSociale} riattivato`;
  const motivoLine = p.motivo
    ? `\nNota dall'admin: ${p.motivo}`
    : '';
  const text =
    `Ciao ${p.nomeUtente},\n` +
    `il tuo account ${p.ragioneSociale} e' stato riattivato. ` +
    `Puoi accedere di nuovo a Passaggio Veloce dalle tue credenziali abituali.${motivoLine}`;
  const motivoHtml = p.motivo
    ? `<div style="margin-top:14px;padding:10px 12px;background:#f1f5f9;border-radius:8px;font-size:12.5px;color:#334155"><strong>Nota dall'admin:</strong><br>${escapeHtml(p.motivo)}</div>`
    : '';
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#16a34a">Account riattivato</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeUtente)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      l&apos;account associato a <strong>${escapeHtml(p.ragioneSociale)}</strong> e&apos;
      stato riattivato. Puoi accedere di nuovo a Passaggio Veloce con le
      tue credenziali abituali.
    </p>
    ${motivoHtml}
  `);
  return { subject, html, text };
}

export function tplN16AccountEliminato(
  p: N16AccountEliminatoPayload,
): NotificaContent {
  const subject = `Account ${p.ragioneSociale} eliminato`;
  const text =
    `Ciao ${p.nomeUtente},\n` +
    `l'account ${p.ragioneSociale} e' stato eliminato definitivamente da un ` +
    `amministratore. I dati personali saranno cancellati entro 90 giorni ` +
    `(retention legale). Le pratiche storiche restano per audit ma anonimizzate.\n` +
    `Per chiarimenti contatta assistenza@passaggioveloce.it.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#dc2626">Account eliminato</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeUtente)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      l&apos;account <strong>${escapeHtml(p.ragioneSociale)}</strong> e&apos; stato eliminato
      definitivamente da un amministratore. Non potrai piu&apos; accedere alla
      piattaforma con le credenziali precedenti.
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      <strong>Compliance GDPR</strong><br>
      I dati personali (documenti, recapiti) saranno cancellati entro
      <strong>90 giorni</strong> per esigenze di retention legale. Le pratiche
      storiche restano per audit ma anonimizzate.
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      Per chiarimenti scrivi a <a href="mailto:assistenza@passaggioveloce.it">assistenza@passaggioveloce.it</a>.
    </p>
  `);
  return { subject, html, text };
}

/**
 * Clausola 12.3-bis: sospensione della singola utenza (non dell'intera
 * azienda — v. N14/tplN14AccountSospeso). L'account aziendale e le altre
 * utenze restano operativi: il testo lo dichiara esplicitamente perché è
 * il punto che distingue questa misura dalla sospensione dell'account (12.3).
 */
export function tplN45UtenteSospeso(
  p: N45UtenteSospesoPayload,
): NotificaContent {
  const subject = `La tua utenza su ${p.ragioneSociale} è stata sospesa`;
  const text =
    `Ciao ${p.nomeUtente},\n` +
    `la tua utenza sulla piattaforma Passaggio Veloce, associata a ${p.ragioneSociale}, ` +
    `e' stata sospesa da un amministratore.\n` +
    `Motivo: ${p.motivo}\n` +
    `L'account aziendale e le altre utenze di ${p.ragioneSociale} restano pienamente ` +
    `operativi: la sospensione riguarda esclusivamente questa utenza.\n` +
    `Puoi chiedere il riesame scrivendo a assistenza@passaggioveloce.it.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#dc2626">La tua utenza è stata sospesa</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeUtente)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la tua utenza sulla piattaforma Passaggio Veloce, associata a
      <strong>${escapeHtml(p.ragioneSociale)}</strong>, e&apos; stata sospesa da un
      amministratore. Non puoi accedere alla piattaforma fino alla riattivazione.
    </p>
    <div style="background:#fef2f2;border:1px solid #dc262633;border-radius:10px;padding:12px 14px;font-size:13px;color:#0a2540"><strong>Motivo:</strong> ${escapeHtml(p.motivo)}</div>
    <p style="margin:16px 0 0;color:#334155;font-size:13px">
      L&apos;account aziendale di <strong>${escapeHtml(p.ragioneSociale)}</strong> e le
      altre eventuali utenze restano pienamente operativi: la sospensione
      riguarda esclusivamente questa utenza.
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      Puoi chiedere il riesame scrivendo a <a href="mailto:assistenza@passaggioveloce.it">assistenza@passaggioveloce.it</a>.
    </p>
  `);
  return { subject, html, text };
}

function labelTipoSegnalazione(t: string): string {
  if (t === 'FERMO_AMMINISTRATIVO') return 'Fermo amministrativo';
  if (t === 'IPOTECA') return 'Ipoteca';
  if (t === 'DOCUMENTO_NON_VALIDO') return 'Documento non valido';
  return 'Altro';
}

export function tplN17BrokerPenaleAddebitata(
  p: N17BrokerPenaleAddebitataPayload,
): NotificaContent {
  const tipoLbl = labelTipoSegnalazione(p.tipoSegnalazione);
  const subject = `⚠️ Penale di ${formatCurrencyCent(p.importoPenaleCent)} addebitata — pratica ${p.codicePratica}`;
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `la pratica ${p.codicePratica}${p.targa ? ` (${p.targa})` : ''} e' stata annullata ` +
    `in seguito a segnalazione di "${tipoLbl}" verificata dal team Passaggio Veloce.\n` +
    `Sono stati detratti ${formatCurrencyCent(p.importoPenaleCent)} dal tuo wallet.\n` +
    (p.veicoliSegnalati.length > 0
      ? `Veicoli segnalati (${p.veicoliSegnalati.length}): ${p.veicoliSegnalati.join(', ')}.\n`
      : '') +
    `Saldo attuale: ${formatCurrencyCent(p.saldoWalletCent)}.\n` +
    (p.saldoWalletCent < 0
      ? 'Il saldo è negativo: dovrai reintegrarlo prima di poter ricevere payout.\n'
      : '') +
    `Per chiarimenti contatta assistenza@passaggioveloce.it.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#dc2626">Penale addebitata</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeBroker)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la pratica <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''} è
      stata annullata in seguito a segnalazione di <strong>${tipoLbl}</strong>
      verificata dal nostro team.
    </p>
    <div style="background:#fef2f2;border:1px solid #dc262633;border-radius:10px;padding:14px;font-size:13px;color:#0a2540">
      <strong style="color:#dc2626">−${formatCurrencyCent(p.importoPenaleCent)}</strong> detratti dal tuo wallet.<br>
      ${
        p.veicoliSegnalati.length > 0
          ? `Veicoli segnalati (${p.veicoliSegnalati.length}): <strong>${escapeHtml(p.veicoliSegnalati.join(', '))}</strong><br>`
          : ''
      }
      Saldo attuale: <strong>${formatCurrencyCent(p.saldoWalletCent)}</strong>
    </div>
    ${
      p.saldoWalletCent < 0
        ? `<div style="margin-top:12px;background:#fef3c7;border:1px solid #f59e0b33;border-radius:10px;padding:12px 14px;font-size:13px;color:#0a2540">⚠️ Il tuo saldo è negativo. Reintegralo per sbloccare i payout futuri.</div>`
        : ''
    }
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      Per chiarimenti scrivi a <a href="mailto:assistenza@passaggioveloce.it">assistenza@passaggioveloce.it</a>.
    </p>
  `);
  return { subject, html, text };
}

export function tplN18AgenziaSegnalazioneConfermata(
  p: N18AgenziaSegnalazioneConfermataPayload,
): NotificaContent {
  const tipoLbl = labelTipoSegnalazione(p.tipoSegnalazione);
  const subject = `Segnalazione confermata — pratica ${p.codicePratica} annullata`;
  const text =
    `Ciao ${p.nomeAgenzia},\n` +
    `la tua segnalazione di "${tipoLbl}" sulla pratica ${p.codicePratica}` +
    `${p.targa ? ` (${p.targa})` : ''} e' stata confermata dal team.\n` +
    `La pratica e' annullata e nessun fee verra' addebitato. Grazie per la verifica.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#16a34a">Segnalazione confermata</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeAgenzia)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la tua segnalazione di <strong>${tipoLbl}</strong> sulla pratica
      <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''} è stata
      confermata dal team. La pratica è annullata, nessun fee ti verrà addebitato.
    </p>
    <div style="background:#ecfdf5;border:1px solid #16a34a33;border-radius:10px;padding:12px 14px;font-size:13px;color:#0a2540">
      Grazie per il controllo: il tuo presidio ha tutelato l'integrità del marketplace.
    </div>
  `);
  return { subject, html, text };
}

export function tplN43AgenziaSegnalazioneRespinta(
  p: N43AgenziaSegnalazioneRespintaPayload,
): NotificaContent {
  const tipoLbl = labelTipoSegnalazione(p.tipoSegnalazione);
  const subject = `Segnalazione respinta — pratica ${p.codicePratica} prosegue`;
  const text =
    `Ciao ${p.nomeAgenzia},\n` +
    `la tua segnalazione di "${tipoLbl}" sulla pratica ${p.codicePratica}` +
    `${p.targa ? ` (${p.targa})` : ''} e' stata verificata dal team Passaggio Veloce ` +
    `ed e' stata respinta.\n` +
    `Motivo: ${p.motivo}\n` +
    `La pratica prosegue regolarmente: puoi continuare a lavorarla normalmente.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Segnalazione respinta</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeAgenzia)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la tua segnalazione di <strong>${tipoLbl}</strong> sulla pratica
      <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''} è stata
      verificata dal nostro team ed è stata <strong>respinta</strong>.
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      <strong>Motivo del respingimento</strong><br>
      ${escapeHtml(p.motivo)}
    </div>
    <p style="margin:16px 0 0;color:#334155;font-size:14px">
      La pratica <strong>prosegue regolarmente</strong>: puoi continuare a lavorarla
      normalmente dalla tua dashboard, come prima della segnalazione.
    </p>
  `);
  return { subject, html, text };
}

/**
 * Controparte broker di N18/N43: prima di questa notifica la pratica del
 * broker mostrava "Segnalata / in revisione" (stato-extra.ts) e la pill
 * spariva nel silenzio al respingimento, senza che il broker sapesse
 * l'esito. Tono rassicurante: per lui è una buona notizia. Non riporta il
 * motivo del respingimento né la nota dell'agenzia (non è nel payload).
 */
export function tplN44BrokerSegnalazioneRespinta(
  p: N44BrokerSegnalazioneRespintaPayload,
): NotificaContent {
  const tipoLbl = labelTipoSegnalazione(p.tipoSegnalazione);
  const subject = `Segnalazione respinta — pratica ${p.codicePratica} prosegue regolarmente`;
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `la segnalazione di "${tipoLbl}" ricevuta sulla pratica ${p.codicePratica}` +
    `${p.targa ? ` (${p.targa})` : ''} e' stata verificata dal team Passaggio Veloce ` +
    `ed e' stata respinta.\n` +
    `Nessuna penale e' stata addebitata al tuo wallet.\n` +
    `La pratica prosegue regolarmente: puoi continuare a lavorarla normalmente.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#16a34a">Segnalazione respinta — nessun addebito</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeBroker)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la segnalazione di <strong>${tipoLbl}</strong> ricevuta sulla pratica
      <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''} è stata
      verificata dal nostro team ed è stata <strong>respinta</strong>.
    </p>
    <div style="background:#ecfdf5;border:1px solid #16a34a33;border-radius:10px;padding:12px 14px;font-size:13px;color:#0a2540">
      Nessuna penale è stata addebitata al tuo wallet.
    </div>
    <p style="margin:16px 0 0;color:#334155;font-size:14px">
      La pratica <strong>prosegue regolarmente</strong>: puoi continuare a lavorarla
      normalmente dalla tua dashboard.
    </p>
  `);
  return { subject, html, text };
}

export function tplN19AdminNuovaSegnalazione(
  p: N19AdminNuovaSegnalazionePayload,
): NotificaContent {
  const tipoLbl = labelTipoSegnalazione(p.tipoSegnalazione);
  const subject = `Nuova segnalazione: ${tipoLbl} — pratica ${p.codicePratica}`;
  const text =
    `Nuova segnalazione ricevuta su pratica ${p.codicePratica}` +
    `${p.targa ? ` (${p.targa})` : ''}.\n` +
    `Tipo: ${tipoLbl}\n` +
    `Broker: ${p.brokerRagioneSociale}\n` +
    `Agenzia: ${p.agenziaRagioneSociale}\n` +
    (p.notaSegnalazione ? `Nota: ${p.notaSegnalazione}\n` : '') +
    `Apri /admin/segnalazioni per verificare e gestire.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Nuova segnalazione</h1>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      Ricevuta segnalazione su pratica <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''}.
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      Tipo: <strong>${tipoLbl}</strong><br>
      Broker: ${escapeHtml(p.brokerRagioneSociale)}<br>
      Agenzia: ${escapeHtml(p.agenziaRagioneSociale)}
      ${p.notaSegnalazione ? `<br>Nota: <em>${escapeHtml(p.notaSegnalazione)}</em>` : ''}
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      Apri <strong>/admin/segnalazioni</strong> per verificare e confermare o respingere.
    </p>
  `);
  return { subject, html, text };
}

function labelMotivoRevisione(m: string): string {
  if (m === 'DOCUMENTO_NON_STANDARD') return 'Documento non standard';
  if (m === 'CASO_NON_PREVISTO_DA_SCHEMA') return 'Caso non previsto dallo schema';
  if (m === 'RICHIESTA_BROKER') return 'Richiesta esplicita del broker';
  return m;
}

export function tplN20AdminRevisioneRichiesta(
  p: N20AdminRevisioneRichiestaPayload,
): NotificaContent {
  const motivoLbl = labelMotivoRevisione(p.motivo);
  const subject = `Revisione manuale richiesta — pratica ${p.codicePratica}`;
  const text =
    `Un broker ha richiesto revisione manuale.\n` +
    `Pratica: ${p.codicePratica}\n` +
    `Motivo: ${motivoLbl}\n` +
    `Note broker: ${p.note}\n` +
    `Apri /admin/revisioni per gestire (entro 24-48h).`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Revisione manuale richiesta</h1>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      Un broker ha richiesto un controllo manuale del team su una pratica
      che non rientra nello schema standard.
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      Pratica: <strong>${p.codicePratica}</strong><br>
      Motivo: <strong>${motivoLbl}</strong><br>
      Note: <em>${escapeHtml(p.note)}</em>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      SLA interno 24-48h. Apri <strong>/admin/revisioni</strong> per chiudere o annullare.
    </p>
  `);
  return { subject, html, text };
}

export function tplN21BrokerRevisioneCompletata(
  p: N21BrokerRevisioneCompletataPayload,
): NotificaContent {
  const esitoLbl = p.esito === 'RISOLTA' ? 'risolta' : 'annullata';
  const subject = `Revisione ${esitoLbl} — pratica ${p.codicePratica}`;
  const colorBg = p.esito === 'RISOLTA' ? '#ecfdf5' : '#fef2f2';
  const colorBorder =
    p.esito === 'RISOLTA' ? '#16a34a33' : '#dc262633';
  const colorTitle = p.esito === 'RISOLTA' ? '#16a34a' : '#dc2626';
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `il team ha chiuso la revisione manuale sulla pratica ${p.codicePratica}.\n` +
    `Esito: ${esitoLbl.toUpperCase()}\n` +
    (p.noteEsito ? `Note: ${p.noteEsito}\n` : '') +
    (p.esito === 'RISOLTA'
      ? 'Puoi riprendere il wizard normalmente con le indicazioni ricevute.\n'
      : 'La pratica è stata annullata.\n');
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:${colorTitle}">Revisione ${esitoLbl}</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeBroker)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      il team ha chiuso la revisione manuale sulla pratica
      <strong>${p.codicePratica}</strong>.
    </p>
    <div style="background:${colorBg};border:1px solid ${colorBorder};border-radius:10px;padding:14px;font-size:13px;color:#0a2540">
      Esito: <strong>${esitoLbl.toUpperCase()}</strong>
      ${p.noteEsito ? `<br><br>Note del team: <em>${escapeHtml(p.noteEsito)}</em>` : ''}
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      ${
        p.esito === 'RISOLTA'
          ? 'Puoi riprendere il wizard normalmente con le indicazioni ricevute.'
          : 'La pratica è annullata. Per chiarimenti scrivi a assistenza@passaggioveloce.it.'
      }
    </p>
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
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeBroker)}</strong>,</p>
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

export function tplN52BrokerZonaNonCoperta(p: N52BrokerZonaNonCopertaPayload): NotificaContent {
  const subject = `Nessuna agenzia disponibile entro ${p.raggioMaxKm} km — pratica ${p.codicePratica}`;
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `nessuna agenzia disponibile entro ${p.raggioMaxKm} km dal luogo indicato per la pratica ` +
    `${p.codicePratica}${p.targa ? ` (${p.targa})` : ''}.\n` +
    `Puoi contattare direttamente un'agenzia di fiducia; la richiesta resta comunque attiva.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Zona non coperta</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeBroker)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      nessuna agenzia disponibile entro <strong>${p.raggioMaxKm} km</strong> dal luogo indicato per la
      pratica <strong>${escapeHtml(p.codicePratica)}</strong>${p.targa ? ` (${escapeHtml(p.targa)})` : ''}.
    </p>
    <p style="margin:0;font-size:12px;color:#64748b">
      Puoi contattare direttamente un'agenzia di fiducia; la richiesta resta comunque attiva:
      continueremo a cercare un'agenzia disponibile.
    </p>
  `);
  return { subject, html, text };
}

// ════════════════════════════════════════════════════════
// AF-N — Notifiche referral (FASE 13)
// ════════════════════════════════════════════════════════

export type N22ReferralSignupPayload = {
  /** Referente che riceve la notifica */
  nomeReferente: string;
  /** Ragione sociale del nuovo iscritto */
  referralRagioneSociale: string;
  /** Tipo del nuovo iscritto */
  tipoReferral: 'BROKER' | 'AGENZIA';
  /** Città/provincia del referral per contesto */
  citta: string;
  provincia: string;
};

export type N23ReferralFirstPraticaPayload = {
  nomeReferente: string;
  referralRagioneSociale: string;
  tipoReferral: 'BROKER' | 'AGENZIA';
  codicePratica: string;
  importoCommissioneCent: number;
};

export type N24PayoutAffiliationAvailablePayload = {
  nomeReferente: string;
  /** Saldo wallet attuale (totale) — se ≥ soglia il payout è disponibile */
  saldoWalletCent: number;
  /** Soglia configurata (es. 50000 cent = €500) */
  sogliaCent: number;
};

export type N25MonthlyAffiliationRecapPayload = {
  nomeReferente: string;
  /** Mese del recap in formato "Aprile 2026" */
  meseLabel: string;
  /** Numero commissioni accreditate il mese */
  numCommissioni: number;
  /** Importo totale accreditato il mese (cent) */
  totaleAccreditatoCent: number;
  /** Numero referral attivi (referral con almeno 1 pratica firmata) */
  numReferralAttivi: number;
  /** Saldo wallet attuale (cent) — utile per CTA payout */
  saldoWalletCent: number;
};

export function tplN22ReferralSignup(p: N22ReferralSignupPayload): NotificaContent {
  const tipoLabel = p.tipoReferral === 'BROKER' ? 'broker' : 'agenzia';
  const subject = `🎉 ${p.referralRagioneSociale} si è iscritto col tuo link`;
  const text =
    `Ciao ${p.nomeReferente},\n` +
    `${p.referralRagioneSociale} (${tipoLabel} di ${p.citta}, ${p.provincia}) ` +
    `si è appena registrato a Passaggio Veloce col tuo link affiliazione.\n` +
    `Da ora, ogni pratica che firmano genera per te una commissione automatica.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Nuovo referral 🎉</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeReferente)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      <strong>${escapeHtml(p.referralRagioneSociale)}</strong> (${tipoLabel} di ${escapeHtml(p.citta)},
      ${escapeHtml(p.provincia)}) si è appena registrato col tuo link affiliazione.
    </p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      Da ora, ogni pratica firmata dal tuo referral genera per te una commissione
      automatica nel wallet.
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      Continua a invitare colleghi: vedi i tuoi referral attivi nella sezione Affiliazione.
    </p>
  `);
  return { subject, html, text };
}

export function tplN23ReferralFirstPratica(
  p: N23ReferralFirstPraticaPayload,
): NotificaContent {
  const tipoLabel = p.tipoReferral === 'BROKER' ? 'broker' : 'agenzia';
  const subject = `Prima pratica di ${p.referralRagioneSociale} firmata 🚗`;
  const text =
    `Ciao ${p.nomeReferente},\n` +
    `${p.referralRagioneSociale} (tuo referral ${tipoLabel}) ha firmato la prima ` +
    `pratica ${p.codicePratica}.\n` +
    `Hai guadagnato ${formatCurrencyCent(p.importoCommissioneCent)} di commissione affiliazione.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Prima pratica! 🚗</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeReferente)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      <strong>${escapeHtml(p.referralRagioneSociale)}</strong> (tuo referral ${tipoLabel}) ha
      firmato la sua prima pratica <strong>${p.codicePratica}</strong>.
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      Commissione accreditata:
      <strong style="color:#16a34a">+${formatCurrencyCent(p.importoCommissioneCent)}</strong>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      Continueremo ad accreditarti la commissione su tutte le pratiche future del tuo referral.
    </p>
  `);
  return { subject, html, text };
}

export function tplN24PayoutAffiliationAvailable(
  p: N24PayoutAffiliationAvailablePayload,
): NotificaContent {
  const subject = `💰 Hai raggiunto la soglia per il payout (${formatCurrencyCent(p.saldoWalletCent)})`;
  const text =
    `Ciao ${p.nomeReferente},\n` +
    `il tuo wallet ha superato la soglia di ${formatCurrencyCent(p.sogliaCent)} ` +
    `(saldo attuale: ${formatCurrencyCent(p.saldoWalletCent)}).\n` +
    `Puoi richiedere il payout dalla sezione Wallet quando vuoi.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Soglia payout raggiunta 💰</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeReferente)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      Il tuo wallet ha superato la soglia di
      <strong>${formatCurrencyCent(p.sogliaCent)}</strong>.
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      Saldo attuale: <strong>${formatCurrencyCent(p.saldoWalletCent)}</strong>
    </div>
    <p style="margin:16px 0 0;font-size:13px;color:#334155">
      Puoi richiedere il payout dalla sezione <strong>Wallet</strong> della tua dashboard
      quando vuoi.
    </p>
  `);
  return { subject, html, text };
}

export type N31ValutaAgenziaPayload = {
  codicePratica: string;
  targa: string | null;
  agenziaNome: string;
  nomeBroker: string;
  /** URL assoluto alla pagina pratica dove valutare. */
  praticaUrl: string;
};

export function tplN31ValutaAgenzia(p: N31ValutaAgenziaPayload): NotificaContent {
  const subject = `Com'è andata con ${p.agenziaNome}? Lascia una valutazione`;
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `la pratica ${p.codicePratica}${p.targa ? ` (${p.targa})` : ''} è stata completata da ` +
    `${p.agenziaNome}. La tua valutazione aiuta gli altri broker e migliora il servizio.\n` +
    `Valuta qui: ${p.praticaUrl}`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Valuta l'agenzia</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeBroker)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la pratica <strong>${p.codicePratica}</strong>${p.targa ? ` (${p.targa})` : ''} è stata
      completata da <strong>${escapeHtml(p.agenziaNome)}</strong>. La tua valutazione aiuta gli altri broker.
    </p>
    ${ctaButton(p.praticaUrl, "Valuta l'agenzia →")}
  `);
  return { subject, html, text };
}

export function tplN25MonthlyAffiliationRecap(
  p: N25MonthlyAffiliationRecapPayload,
): NotificaContent {
  const subject = `📊 Recap affiliazione ${p.meseLabel} — ${formatCurrencyCent(p.totaleAccreditatoCent)} accreditati`;
  const text =
    `Ciao ${p.nomeReferente},\n` +
    `ecco il recap delle commissioni di affiliazione per ${p.meseLabel}:\n` +
    `- ${p.numCommissioni} commission${p.numCommissioni === 1 ? 'e' : 'i'} accreditate\n` +
    `- Totale: ${formatCurrencyCent(p.totaleAccreditatoCent)}\n` +
    `- Referral attivi (con almeno 1 pratica firmata): ${p.numReferralAttivi}\n` +
    `Saldo wallet attuale: ${formatCurrencyCent(p.saldoWalletCent)}`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Recap affiliazione ${p.meseLabel}</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeReferente)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      Ecco il recap del programma affiliazione per <strong>${p.meseLabel}</strong>:
    </p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px">
      <tr style="background:#f1f5f9">
        <td style="padding:10px 12px;font-size:12.5px;color:#64748b;border-radius:8px 0 0 8px">Commissioni accreditate</td>
        <td style="padding:10px 12px;font-size:14px;font-weight:bold;color:#0a2540;text-align:right;border-radius:0 8px 8px 0">${p.numCommissioni}</td>
      </tr>
      <tr style="height:4px"></tr>
      <tr style="background:#f1f5f9">
        <td style="padding:10px 12px;font-size:12.5px;color:#64748b;border-radius:8px 0 0 8px">Totale accreditato</td>
        <td style="padding:10px 12px;font-size:16px;font-weight:bold;color:#16a34a;text-align:right;border-radius:0 8px 8px 0">${formatCurrencyCent(p.totaleAccreditatoCent)}</td>
      </tr>
      <tr style="height:4px"></tr>
      <tr style="background:#f1f5f9">
        <td style="padding:10px 12px;font-size:12.5px;color:#64748b;border-radius:8px 0 0 8px">Referral attivi</td>
        <td style="padding:10px 12px;font-size:14px;font-weight:bold;color:#0a2540;text-align:right;border-radius:0 8px 8px 0">${p.numReferralAttivi}</td>
      </tr>
    </table>
    <div style="background:#fff7ed;border-left:3px solid #e86d21;padding:10px 12px;font-size:13px;color:#334155;border-radius:8px">
      <strong>Saldo wallet attuale:</strong> ${formatCurrencyCent(p.saldoWalletCent)}
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      Continua a invitare colleghi: il tuo link è sempre disponibile nella sezione Affiliazione.
    </p>
  `);
  return { subject, html, text };
}

export function tplN41AdminNuovaSegnalazione(p: N41AdminNuovaSegnalazionePayload): NotificaContent {
  const subject = 'Nuova segnalazione da creazione pratica';
  const text =
    `${p.ragioneSociale} ha segnalato un problema in creazione pratica.\n` +
    `Step: ${p.step} — Tipo: ${p.tipo}\n${p.estratto}\n` +
    `Apri /admin/segnalazioni-creazione per rispondere.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Nuova segnalazione</h1>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      <strong>${escapeHtml(p.ragioneSociale)}</strong> ha segnalato un problema durante
      la creazione di una pratica (step ${p.step}, tipo: ${escapeHtml(p.tipo)}).
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      <em>${escapeHtml(p.estratto)}</em>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      Apri <strong>/admin/segnalazioni-creazione</strong> per rispondere.
    </p>
  `);
  return { subject, html, text };
}

export type N26EmailPartenzaPayload = {
  nomeReferente: string;
  /** Corpo del messaggio in plain-text (default da `defaultMessaggioPartenza`,
   *  ritoccabile ad-hoc dall'admin nel modale). Reso come paragrafi HTML sicuri. */
  messaggio: string;
  categoria: 'BROKER' | 'AGENZIA';
  linkUrl: string;
  unsubUrl: string;
  codice?: { code: string; importoEuro: number };
};

/**
 * Converte il messaggio plain-text dell'admin in paragrafi HTML sicuri:
 * riga vuota (`\n\n`) = nuovo `<p>`, singolo a-capo = `<br>`. Tutto escapato
 * con `escapeHtml` per evitare HTML/JS iniettato nel corpo dell'email.
 */
function messaggioPartenzaToHtml(messaggio: string): string {
  return messaggio
    .trim()
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p style="margin:0 0 12px;font-size:14px;color:#334155">${escapeHtml(
          para,
        ).replace(/\n/g, '<br>')}</p>`,
    )
    .join('');
}

/**
 * Email a freddo (lead senza account) inviata dal team sales dopo una
 * telefonata di attivazione. NON passa dal gating preferenze di
 * `sendNotification` (che richiede `userId`): il link di disiscrizione va
 * quindi incluso direttamente nel corpo, sia text che html (il segnaposto
 * `<!--PV_UNSUB-->` del layout resta volutamente non sostituito qui).
 */
export function tplN26EmailPartenza(p: N26EmailPartenzaPayload): NotificaContent {
  const isBroker = p.categoria === 'BROKER';
  const ctaLabel = isBroker ? 'Registra la tua concessionaria' : 'Registra la tua agenzia';

  const nome = escapeHtml(p.nomeReferente);
  const messaggioHtml = messaggioPartenzaToHtml(p.messaggio);

  const checklist = [
    'Carta d\'identità e tessera sanitaria del titolare (fronte e retro)',
    'Visura camerale in PDF (dal Registro Imprese)',
    'P.IVA, PEC, codice SDI e regime fiscale',
    'IBAN aziendale',
  ];

  const checklistHtml = checklist
    .map(
      (v) =>
        `<li style="margin:0 0 6px;font-size:14px;color:#334155">${escapeHtml(v)}</li>`,
    )
    .join('');

  const codiceHtml = p.codice
    ? `<div style="margin-top:18px;background:#fff7ed;border:1px solid #f59e0b33;border-radius:10px;padding:12px 14px;font-size:14px;color:#0a2540">
        🎁 <strong>Hai ${p.codice.importoEuro} € di credito di benvenuto.</strong><br>
        Il codice <strong>${escapeHtml(p.codice.code)}</strong> è già incluso nel link: lo troverai precompilato all\'ultimo passaggio, non devi ricordartelo.
      </div>`
    : '';

  const body = `
    <p style="margin:0 0 12px;font-size:15px;color:#0a2540">Buongiorno ${nome},</p>
    ${messaggioHtml}
    <div style="margin:6px 0 18px">${ctaButton(p.linkUrl, ctaLabel)}</div>
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#0a2540">Cosa tenere a portata di mano</p>
    <ul style="margin:0 0 4px;padding-left:18px">${checklistHtml}</ul>
    ${codiceHtml}
    <p style="margin:18px 0 0;font-size:13px;color:#64748b">Per qualsiasi cosa trovi i nostri contatti qui sotto.</p>
    <p style="margin:10px 0 0;padding-top:10px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8">Non vuoi più ricevere queste email? <a href="${escapeHtml(p.unsubUrl)}" style="color:#94a3b8">Disiscriviti</a></p>
  `;

  const codiceText = p.codice
    ? `\n\nHai ${p.codice.importoEuro} € di credito di benvenuto. Il codice ${p.codice.code} è già incluso nel link e precompilato all\'ultimo passaggio.`
    : '';

  const text = `Buongiorno ${p.nomeReferente},

${p.messaggio.trim()}

Registrati qui: ${p.linkUrl}

Cosa tenere a portata di mano:
- ${checklist.join('\n- ')}${codiceText}

Per qualsiasi cosa trovi i nostri contatti in fondo all\'email.

Per non ricevere più queste email: ${p.unsubUrl}`;

  return {
    subject: 'Passaggio Veloce — il link per registrarti',
    html: emailLayout(body),
    text,
  };
}

export function tplN42BrokerSegnalazioneGestita(p: N42BrokerSegnalazioneGestitaPayload): NotificaContent {
  const subject = 'Risposta alla tua segnalazione';
  const saluto = p.nomeBroker ? `Ciao ${escapeHtml(p.nomeBroker)},` : 'Ciao,';
  const text =
    `${p.nomeBroker || ''}\nRiguardo alla tua segnalazione in creazione pratica:\n` +
    `${p.nota}\nPer dubbi rispondi pure a questa email.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Risposta alla tua segnalazione</h1>
    <p style="margin:0 0 12px;color:#334155;font-size:14px">${saluto}</p>
    <p style="margin:0 0 12px;color:#334155;font-size:14px">
      riguardo alla segnalazione inviata durante la creazione di una pratica:
    </p>
    <div style="background:#f1f5f9;border-radius:10px;padding:12px 14px;font-size:13px;color:#334155">
      ${escapeHtml(p.nota)}
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">Per dubbi rispondi pure a questa email.</p>
  `);
  return { subject, html, text };
}

// ════════════════════════════════════════════════════════
// N46-N49 — Ciclo di vita visura camerale (clausola 8 dei Termini)
// ════════════════════════════════════════════════════════

/** Etichetta leggibile, coerente con l'UI esistente (v. admin/ateco/client.tsx). */
function labelCompanyTypeVisura(t: 'DEALER' | 'AGENZIA'): string {
  return t === 'AGENZIA' ? 'Agenzia' : 'Broker';
}

/** "1 giorno" / "N giorni" — mai "1 giorni" (bug di pluralizzazione già trovato una volta). */
function giorniLabel(n: number): string {
  return n === 1 ? '1 giorno' : `${n} giorni`;
}

/**
 * Conseguenza della visura scaduta, differenziata per tipo azienda e per
 * tempo verbale. Il broker CONTINUA a creare e gestire pratiche normalmente:
 * perde solo la possibilità di prelevare dal wallet (clausola 8 dei Termini —
 * v. il guard identico in `eseguiPayoutImmediato`). Dirgli che è "bloccato"
 * sarebbe falso. L'agenzia invece si ferma del tutto: non gestisce pratiche
 * in corso, non ne riceve di nuove, non preleva.
 *
 * `futuro`: usata da N46 (preavviso, non ancora accaduto — "non potrai...").
 * `presente`: usata da N47 (il blocco è già attivo — "non puoi...").
 */
function conseguenzaVisura(t: 'DEALER' | 'AGENZIA', tempo: 'futuro' | 'presente'): string {
  if (tempo === 'futuro') {
    return t === 'AGENZIA'
      ? 'non potrai gestire le pratiche in corso, non ne riceverai di nuove e non potrai effettuare prelievi dal wallet'
      : 'non potrai effettuare prelievi dal tuo wallet';
  }
  return t === 'AGENZIA'
    ? 'non puoi gestire le pratiche in corso, non ne ricevi di nuove e non puoi effettuare prelievi dal wallet'
    : 'non puoi effettuare prelievi dal tuo wallet';
}

export function tplN46VisuraInScadenza(p: N46VisuraInScadenzaPayload): NotificaContent {
  const giorni = giorniLabel(p.giorniRimanenti);
  const nome = escapeHtml(p.nomeAzienda);
  const cons = conseguenzaVisura(p.companyType, 'futuro');
  const subject = `La tua visura camerale scade fra ${giorni}`;
  const text =
    `Ciao ${p.nomeAzienda},\n` +
    `la visura camerale che ci hai fornito scade fra ${giorni} (clausola 8 dei Termini).\n` +
    `Ci serve aggiornata per poterti fatturare correttamente: alla scadenza ${cons}, ` +
    `finché non ne carichi una nuova.\n` +
    `Aggiornala qui: ${p.rimedioUrl}`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#b45309">La visura camerale sta per scadere</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${nome}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la visura camerale che ci hai fornito scade <strong>fra ${giorni}</strong>
      (clausola 8 dei Termini). Ci serve aggiornata per poterti fatturare correttamente:
      alla scadenza <strong>${cons}</strong>, finché non ne carichi una nuova.
    </p>
    ${ctaButton(p.rimedioUrl, 'Aggiorna la visura')}
  `);
  return { subject, html, text };
}

export function tplN47VisuraScaduta(p: N47VisuraScadutaPayload): NotificaContent {
  const giorni = giorniLabel(p.giorniTrascorsi);
  const nome = escapeHtml(p.nomeAzienda);
  const cons = conseguenzaVisura(p.companyType, 'presente');
  const subject = 'Visura camerale scaduta — operatività limitata';
  const text =
    `Ciao ${p.nomeAzienda},\n` +
    `la visura camerale che ci hai fornito è scaduta da ${giorni} (clausola 8 dei Termini).\n` +
    `Da ora ${cons}, finché non ne carichi una nuova.\n` +
    `L'accesso alla Piattaforma resta attivo: è una limitazione operativa sulle sole ` +
    `funzioni collegate alla visura, non riguarda il resto dell'account.\n` +
    `Aggiornala qui: ${p.rimedioUrl}`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#dc2626">Visura camerale scaduta</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${nome}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la visura camerale che ci hai fornito è scaduta da <strong>${giorni}</strong>
      (clausola 8 dei Termini). <strong>Da ora ${cons}</strong>, finché non ne carichi
      una nuova.
    </p>
    ${ctaButton(p.rimedioUrl, 'Aggiorna la visura')}
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">
      L&apos;accesso alla Piattaforma resta attivo: è una limitazione operativa sulle
      sole funzioni collegate alla visura, non riguarda il resto dell&apos;account.
    </p>
  `);
  return { subject, html, text };
}

/**
 * Al broker: la sua pratica è ferma per un adempimento ALTRUI (la visura
 * dell'agenzia che l'ha in carico), non per colpa sua. Il broker continua a
 * creare e gestire tutte le sue altre pratiche normalmente — questa email
 * riguarda SOLO questa pratica, e lo dice esplicitamente perché altrimenti
 * suonerebbe come se l'intero account fosse coinvolto.
 */
export function tplN48BrokerPraticaCongelata(p: N48BrokerPraticaCongelataPayload): NotificaContent {
  const nomeBroker = escapeHtml(p.nomeBroker);
  const nomeAgenzia = escapeHtml(p.nomeAgenzia);
  const subject = 'Una tua pratica è temporaneamente ferma';
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `una tua pratica affidata a ${p.nomeAgenzia} è temporaneamente ferma: l'agenzia deve ` +
    `aggiornare la propria visura camerale (clausola 8 dei Termini) prima di poterla lavorare.\n` +
    `Non devi fare nulla: riguarda solo questa pratica, puoi continuare normalmente a ` +
    `creare e gestire tutte le tue altre pratiche. Riprenderà appena l'agenzia avrà regolarizzato.\n` +
    `Dettagli: ${p.praticaUrl}`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#b45309">Una tua pratica è temporaneamente ferma</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${nomeBroker}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      una tua pratica affidata a <strong>${nomeAgenzia}</strong> è temporaneamente ferma:
      l&apos;agenzia deve aggiornare la propria visura camerale (clausola 8 dei Termini)
      prima di poterla lavorare.
    </p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      <strong>Non devi fare nulla</strong>: riguarda solo questa pratica, puoi continuare
      normalmente a creare e gestire tutte le tue altre pratiche. Riprenderà appena
      l&apos;agenzia avrà regolarizzato.
    </p>
    ${ctaButton(p.praticaUrl, 'Vedi la pratica')}
  `);
  return { subject, html, text };
}

/**
 * All'admin: un aggiornamento visura è stato ACCETTATO nonostante l'ATECO non
 * ammesso (v. `eseguiControlli` in `lib/visura/aggiorna.ts`, punto 4 — bloccare
 * qui creerebbe un vicolo cieco per l'azienda). Serve solo a far valutare il
 * caso a un umano, non descrive un blocco.
 */
export function tplN49AdminAtecoNonIdoneo(p: N49AdminAtecoNonIdoneoPayload): NotificaContent {
  const nome = escapeHtml(p.nomeAzienda);
  const tipoLbl = labelCompanyTypeVisura(p.companyType);
  const codes = escapeHtml(p.atecoCodes);
  const subject = `ATECO non idoneo dopo aggiornamento visura — ${p.nomeAzienda}`;
  const text =
    `${p.nomeAzienda} (${tipoLbl}) ha aggiornato la visura camerale, ma i codici ATECO ` +
    `risultanti (${p.atecoCodes}) non rientrano fra quelli ammessi.\n` +
    `La visura è stata ACCETTATA comunque, per non lasciare l'azienda bloccata senza una ` +
    `via d'uscita autonoma: valutare il caso.\n` +
    `Scheda azienda: ${p.adminUrl}`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#b45309">ATECO non idoneo dopo aggiornamento visura</h1>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      <strong>${nome}</strong> (${tipoLbl}) ha aggiornato la visura camerale, ma i codici
      ATECO risultanti (<strong>${codes}</strong>) non rientrano fra quelli ammessi.
    </p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      La visura è stata <strong>accettata comunque</strong>, per non lasciare
      l&apos;azienda bloccata senza una via d&apos;uscita autonoma. Valutare il caso.
    </p>
    ${ctaButton(p.adminUrl, 'Apri la scheda azienda')}
  `);
  return { subject, html, text };
}

export type N50AgenziaRevocataPayload = {
  codicePratica: string;
  targa: string | null;
  nomeAgenzia: string;
  motivo: string | null;
};

export function tplN50AgenziaRevocata(p: N50AgenziaRevocataPayload): NotificaContent {
  const subject = `Gestione revocata — pratica ${p.codicePratica}`;
  const text =
    `Ciao ${p.nomeAgenzia},\n` +
    `la gestione della pratica ${p.codicePratica}${p.targa ? ` (${p.targa})` : ''} ` +
    `è stata revocata da Passaggio Veloce perché non risultava lavorata.` +
    `${p.motivo ? `\nMotivo: ${p.motivo}` : ''}\n` +
    `La pratica è stata rimessa in distribuzione ad altre agenzie della zona. Non sono richieste altre azioni.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Gestione revocata</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeAgenzia)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la gestione della pratica <strong>${escapeHtml(p.codicePratica)}</strong>${p.targa ? ` (${escapeHtml(p.targa)})` : ''}
      è stata revocata perché non risultava lavorata. La pratica è stata rimessa in distribuzione ad altre agenzie della zona.
    </p>
    ${p.motivo ? `<div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;font-size:13px;color:#0a2540">Motivo: ${escapeHtml(p.motivo)}</div>` : ''}
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">Non sono richieste altre azioni.</p>
  `);
  return { subject, html, text };
}

export type N51BrokerRimessaInCircoloPayload = {
  codicePratica: string;
  targa: string | null;
  nomeBroker: string;
};

export function tplN51BrokerRimessaInCircolo(p: N51BrokerRimessaInCircoloPayload): NotificaContent {
  const subject = `Pratica ${p.codicePratica} di nuovo in distribuzione`;
  const text =
    `Ciao ${p.nomeBroker},\n` +
    `la pratica ${p.codicePratica}${p.targa ? ` (${p.targa})` : ''} è stata rimessa in distribuzione: ` +
    `l'agenzia che l'aveva presa in carico non l'ha lavorata nei tempi, quindi la stiamo riassegnando ` +
    `a un'altra agenzia della zona. Ti aggiorniamo appena viene accettata.`;
  const html = wrap(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Pratica di nuovo in distribuzione</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nomeBroker)}</strong>,</p>
    <p style="margin:0 0 16px;color:#334155;font-size:14px">
      la pratica <strong>${escapeHtml(p.codicePratica)}</strong>${p.targa ? ` (${escapeHtml(p.targa)})` : ''}
      è stata rimessa in distribuzione: l'agenzia che l'aveva presa in carico non l'ha lavorata nei tempi,
      quindi la stiamo riassegnando a un'altra agenzia della zona.
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">Ti aggiorniamo appena viene accettata.</p>
  `);
  return { subject, html, text };
}
