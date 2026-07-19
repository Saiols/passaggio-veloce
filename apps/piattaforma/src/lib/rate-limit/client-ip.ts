/**
 * IP client "fidato" da usare come chiave di rate-limit (finding M3
 * dell'audit sicurezza pre-lancio).
 *
 * `x-forwarded-for` è una lista CSV "client, proxy1, proxy2, ..." dove ogni hop
 * APPENDE il proprio valore in coda. Il PRIMO valore (il più a sinistra) è
 * quello che il client stesso può dichiarare nella richiesta originale — su
 * Vercel un attaccante può quindi impostare `X-Forwarded-For: 1.2.3.4` e far
 * credere al nostro codice di provenire da un altro IP, bypassando qualunque
 * limite per-IP. Il valore fidato è quello aggiunto per ULTIMO dal proxy più
 * vicino a noi (l'edge Vercel), cioè l'ULTIMO elemento della lista — non il
 * primo. Su Vercel, se presente, `x-real-ip` è ancora più diretto ed è
 * preferito quando disponibile.
 */
export function getClientIp(hdrs: { get(name: string): string | null | undefined }): string {
  const realIp = hdrs.get('x-real-ip');
  if (realIp && realIp.trim()) return realIp.trim();

  const xff = hdrs.get('x-forwarded-for');
  if (xff) {
    const parts = xff
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }

  return 'unknown';
}
