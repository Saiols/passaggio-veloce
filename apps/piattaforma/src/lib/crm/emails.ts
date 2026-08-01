const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Estrae email valide (lowercase, dedup) e scarta il resto. Separatori: , ; spazi, newline. */
export function parseEmails(raw: string): { validi: string[]; scartati: string[] } {
  const parti = (raw ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const validi: string[] = [];
  const scartati: string[] = [];
  const visti = new Set<string>();
  for (const p of parti) {
    if (!EMAIL_RE.test(p)) {
      scartati.push(p);
      continue;
    }
    if (visti.has(p)) continue;
    visti.add(p);
    validi.push(p);
  }
  return { validi, scartati };
}
