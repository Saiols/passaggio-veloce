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
