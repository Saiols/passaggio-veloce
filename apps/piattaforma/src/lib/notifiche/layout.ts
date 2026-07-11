import { BRAND } from '@/lib/seo/brand';
import { escapeHtml } from '@/lib/escape-html';

const LOGO_URL = `${BRAND.url}/brand/logo-email.png`;
const NAVY = '#0a2540';
const ORANGE = '#ff7a00';
const BORDER = '#e2e8f0';
const hostLabel = BRAND.url.replace(/^https?:\/\//, '');

export function ctaButton(href: string, label: string): string {
  // Padding sul <td> (non sull'<a>) così Outlook desktop rispetta l'area cliccabile.
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
    <td style="border-radius:8px;background:${ORANGE};padding:12px 22px">
      <a href="${escapeHtml(href)}" style="display:inline-block;font-size:14px;font-weight:700;color:#1a1a1a;text-decoration:none">${escapeHtml(label)}</a>
    </td>
  </tr></table>`;
}

export function unsubscribeFooterLine(unsubscribeUrl: string, preferencesUrl: string): string {
  return `<p style="margin:10px 0 0;padding-top:10px;border-top:1px solid ${BORDER};font-size:11px;color:#94a3b8">Non vuoi più ricevere queste email? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#94a3b8">Disiscriviti</a> · <a href="${escapeHtml(preferencesUrl)}" style="color:#94a3b8">Preferenze</a></p>`;
}

/**
 * Blocco "Sede della firma": indirizzo della sede che ha accettato la pratica
 * (dove avverrà la firma). Iniettato da `sendNotification` in TUTTE le email
 * legate a una pratica già accettata (segnaposto `<!--PV_SEDE-->` nel layout),
 * così ogni figura coinvolta vede dove recarsi. Ritorna stringhe vuote se non
 * c'è alcun indirizzo utile.
 */
export function sedeFirmaBlock(sede: {
  nome?: string | null;
  indirizzo?: string | null;
  civico?: string | null;
  cap?: string | null;
  citta?: string | null;
  provincia?: string | null;
}): { html: string; text: string } {
  const via = [sede.indirizzo, sede.civico].filter(Boolean).join(' ');
  const cittaRiga = [sede.cap, sede.citta, sede.provincia ? `(${sede.provincia})` : '']
    .filter(Boolean)
    .join(' ');
  const indirizzoCompleto = [via, cittaRiga].filter(Boolean).join(', ');
  if (!indirizzoCompleto && !sede.nome) return { html: '', text: '' };
  const html = `
    <div style="margin-top:16px;background:#f0f9ff;border:1px solid #0ea5e933;border-radius:10px;padding:12px 14px;font-size:13px;color:${NAVY}">
      <strong>Sede della firma</strong><br>
      ${sede.nome ? `${escapeHtml(sede.nome)}<br>` : ''}
      ${via ? `${escapeHtml(via)}<br>` : ''}
      ${cittaRiga ? `${escapeHtml(cittaRiga)}<br>` : ''}
      Sede presso cui si svolge la firma del passaggio di proprietà.
    </div>`;
  const text = `\n\nSede della firma${sede.nome ? `: ${sede.nome}` : ''}${
    indirizzoCompleto ? ` — ${indirizzoCompleto}` : ''
  }.`;
  return { html, text };
}

const headerCell = `<td style="background:${NAVY};border-radius:12px 12px 0 0;padding:16px 24px">
  <img src="${LOGO_URL}" alt="Passaggio Veloce" height="28" style="display:block;border:0;height:28px;width:auto">
</td>`;

const footerCell = `<td style="background:#f8fafc;border:1px solid ${BORDER};border-top:0;border-radius:0 0 12px 12px;padding:18px 24px;text-align:center">
  <p style="margin:0 0 6px;font-size:12px;color:#334155;font-weight:600">${BRAND.legalName} · P.IVA ${BRAND.piva}</p>
  <p style="margin:0 0 2px;font-size:11.5px;color:#64748b">${BRAND.sede}</p>
  <p style="margin:0 0 2px;font-size:11.5px;color:#64748b"><a href="mailto:${BRAND.supportEmail}" style="color:#0054a6;text-decoration:none">${BRAND.supportEmail}</a> · ${BRAND.tel}</p>
  <p style="margin:0;font-size:11.5px;color:#64748b"><a href="${BRAND.url}" style="color:#0054a6;text-decoration:none">${hostLabel}</a></p>
  <!--PV_UNSUB-->
</td>`;

export function emailLayout(body: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9">
    <tr><td style="padding:20px">
      <table role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;margin:0 auto">
        <tr>${headerCell}</tr>
        <tr><td style="height:3px;background:${ORANGE};font-size:0;line-height:0">&nbsp;</td></tr>
        <tr><td style="background:#ffffff;border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">${body}<!--PV_SEDE--></td></tr>
        <tr>${footerCell}</tr>
      </table>
    </td></tr>
  </table>`;
}
