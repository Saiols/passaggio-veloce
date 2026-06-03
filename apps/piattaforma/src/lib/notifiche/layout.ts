import { BRAND } from '@/lib/seo/brand';

const LOGO_URL = `${BRAND.url}/brand/logo-email.png`;
const NAVY = '#0a2540';
const ORANGE = '#ff7a00';
const BORDER = '#e2e8f0';
const hostLabel = BRAND.url.replace(/^https?:\/\//, '');

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function ctaButton(href: string, label: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
    <td style="border-radius:8px;background:${ORANGE}">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#1a1a1a;text-decoration:none;border-radius:8px">${escapeHtml(label)}</a>
    </td>
  </tr></table>`;
}

export function unsubscribeFooterLine(unsubscribeUrl: string, preferencesUrl: string): string {
  return `<p style="margin:10px 0 0;padding-top:10px;border-top:1px solid ${BORDER};font-size:11px;color:#94a3b8">Non vuoi più ricevere queste email? <a href="${escapeHtml(unsubscribeUrl)}" style="color:#94a3b8">Disiscriviti</a> · <a href="${escapeHtml(preferencesUrl)}" style="color:#94a3b8">Preferenze</a></p>`;
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
        <tr><td style="background:#ffffff;border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">${body}</td></tr>
        <tr>${footerCell}</tr>
      </table>
    </td></tr>
  </table>`;
}
