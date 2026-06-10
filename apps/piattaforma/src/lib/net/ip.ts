/**
 * Anonimizza l'IP per minimizzare i dati personali (GDPR).
 * IPv4: primi 3 ottetti (es. 192.168.1.42 → 192.168.1.0)
 * IPv6: primi 4 gruppi di hextet
 */
export function anonymizeIp(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.split(',')[0]?.trim() ?? '';
  if (!trimmed) return null;
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    return parts.slice(0, 4).join(':') + '::';
  }
  const parts = trimmed.split('.');
  if (parts.length !== 4) return trimmed.slice(0, 32);
  return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
}

/**
 * Estrae il primo IP client da un header x-forwarded-for (può essere una lista
 * CSV "client, proxy1, proxy2"), senza anonimizzazione. Usato dove serve l'IP
 * reale come evidenza — es. consenso del mandato SEPA passato a Stripe, che
 * rifiuta una stringa CSV come ip_address.
 */
export function clientIp(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const first = raw.split(',')[0]?.trim();
  return first || null;
}
