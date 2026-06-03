/**
 * Escape per interpolazione sicura di stringhe dentro HTML (inclusi gli apici).
 * Unica fonte: usata da template/layout email e dal provider email console.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
