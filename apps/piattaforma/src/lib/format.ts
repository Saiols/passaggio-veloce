export function formatCurrencyCent(cents: number): string {
  const euro = cents / 100;
  // Intl.NumberFormat può intercalare NBSP (U+00A0) o NARROW NO-BREAK SPACE
  // (U+202F) tra cifra e simbolo a seconda della versione ICU di Node vs
  // Chromium → causa hydration mismatch in SSR. Normalizziamo a spazio
  // standard per consistenza server/client.
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  })
    .format(euro)
    .replace(/[  ]/g, ' ');
}

export function formatDate(d: Date | null | undefined): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium' }).format(d);
}

export function formatDateTime(d: Date | null | undefined): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

export function formatRelative(d: Date | null | undefined, now: Date = new Date()): string {
  if (!d) return '—';
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'adesso';
  if (diffMin < 60) return `${diffMin} min fa`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH} h fa`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 30) return `${diffD} g fa`;
  const diffMo = Math.round(diffD / 30);
  if (diffMo < 12) return diffMo === 1 ? '1 mese fa' : `${diffMo} mesi fa`;
  return formatDate(d);
}
