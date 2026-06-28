import { emailLayout, ctaButton } from '@/lib/notifiche/layout';
import { escapeHtml } from '@/lib/escape-html';

export type EmailContent = { subject: string; html: string; text: string };

/** Layout per email auth/transazionali: niente riga disiscrizione → rimuove il token footer. */
function authLayout(body: string): string {
  return emailLayout(body).replace('<!--PV_UNSUB-->', '');
}

export type RegistrazioneConfermaPayload = {
  nome: string;
  ragioneSociale: string;
  tipo: 'DEALER' | 'AGENZIA';
  verifyUrl: string;
  loginUrl: string;
  needsVerification: boolean;
};

export function tplRegistrazioneConferma(p: RegistrazioneConfermaPayload): EmailContent {
  const subject = `Benvenuto in Passaggio Veloce, ${p.ragioneSociale}`;
  const ruoloBlock =
    p.tipo === 'DEALER'
      ? "Da ora puoi creare pratiche di passaggio di proprietà e affidarle alle agenzie della tua zona: carichi il libretto, l'IA prepara il dossier e ricevi gli aggiornamenti fino alla firma."
      : 'Da ora ricevi le pratiche dei dealer nella tua zona: accetti quelle che ti interessano, le lavori e confermi la firma per incassare la fee.';
  const cta = p.needsVerification
    ? ctaButton(p.verifyUrl, 'Conferma il tuo indirizzo email →')
    : ctaButton(p.loginUrl, 'Vai al login →');
  const ctaNote = p.needsVerification ? 'Il link è valido 24 ore.' : 'Il tuo account è già attivo.';
  const html = authLayout(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Benvenuto in Passaggio Veloce</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao <strong>${escapeHtml(p.nome)}</strong>,</p>
    <p style="margin:0 0 18px;color:#334155;font-size:14px">la registrazione di <strong>${escapeHtml(p.ragioneSociale)}</strong> è andata a buon fine. ${ruoloBlock}</p>
    ${cta}
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">${ctaNote}</p>
  `);
  const text =
    `Ciao ${p.nome},\n` +
    `la registrazione di ${p.ragioneSociale} è andata a buon fine. ${ruoloBlock}\n\n` +
    (p.needsVerification
      ? `Conferma il tuo indirizzo email (valido 24 ore): ${p.verifyUrl}`
      : `Il tuo account è già attivo. Accedi: ${p.loginUrl}`);
  return { subject, html, text };
}

export function tplResetPassword(p: { resetUrl: string }): EmailContent {
  const subject = 'Passaggio Veloce — Reimposta la tua password';
  const html = authLayout(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Reimposta la password</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao,</p>
    <p style="margin:0 0 18px;color:#334155;font-size:14px">Hai richiesto di reimpostare la password del tuo account Passaggio Veloce.</p>
    ${ctaButton(p.resetUrl, 'Reimposta la password →')}
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">Il link è valido 2 ore. Se non sei stato tu, ignora questa email.</p>
  `);
  const text = `Reimposta la password del tuo account Passaggio Veloce (valido 2 ore): ${p.resetUrl}\nSe non sei stato tu, ignora questa email.`;
  return { subject, html, text };
}

export function tplInvitoTeam(p: { ragioneSociale: string; inviteUrl: string }): EmailContent {
  const subject = `Sei stato invitato in ${p.ragioneSociale}`;
  const html = authLayout(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Invito a ${escapeHtml(p.ragioneSociale)}</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao,</p>
    <p style="margin:0 0 18px;color:#334155;font-size:14px">Sei stato invitato a unirti a <strong>${escapeHtml(p.ragioneSociale)}</strong> su Passaggio Veloce. Imposta la tua password per accedere.</p>
    ${ctaButton(p.inviteUrl, 'Attiva il tuo account →')}
    <p style="margin:16px 0 0;font-size:12px;color:#64748b">Il link è valido 7 giorni.</p>
  `);
  const text = `Sei stato invitato in ${p.ragioneSociale} su Passaggio Veloce. Attiva il tuo account (valido 7 giorni): ${p.inviteUrl}`;
  return { subject, html, text };
}

export function tplMandatoFirmatoConferma(p: { nomeAzienda: string }): EmailContent {
  const subject = 'Passaggio Veloce — Mandato fatturazione firmato';
  const html = authLayout(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Mandato firmato</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Ciao,</p>
    <p style="margin:0 0 18px;color:#334155;font-size:14px">Il mandato per la fatturazione per conto terzi di <strong>${escapeHtml(p.nomeAzienda)}</strong> è stato firmato con successo. In allegato trovi una copia del documento.</p>
    <p style="margin:0 0 0;font-size:12px;color:#64748b">Conserva questo documento per i tuoi archivi. Per qualsiasi domanda, contatta il supporto di Passaggio Veloce.</p>
  `);
  const text = `Il mandato per la fatturazione per conto terzi di ${p.nomeAzienda} è stato firmato con successo. Trovi una copia del documento in allegato a questa email.`;
  return { subject, html, text };
}

export function tplOtpMandato(p: { codice: string }): EmailContent {
  const subject = 'Passaggio Veloce — Codice per la firma del mandato';
  const html = authLayout(`
    <h1 style="margin:0 0 8px;font-size:20px;color:#0a2540">Codice di firma</h1>
    <p style="margin:0 0 14px;color:#334155;font-size:14px">Per firmare il «Mandato per fatturazione per conto terzi» usa questo codice:</p>
    <p style="margin:0 0 14px;font-size:28px;font-weight:800;letter-spacing:6px;color:#0a2540">${p.codice}</p>
    <p style="margin:8px 0 0;font-size:12px;color:#64748b">Il codice è valido 10 minuti. Se non hai richiesto la firma, ignora questa email.</p>
  `);
  const text = `Codice per firmare il mandato fatturazione (valido 10 minuti): ${p.codice}`;
  return { subject, html, text };
}
