const FASCE: Record<'MATTINA' | 'POMERIGGIO', { start: string; end: string }> = {
  MATTINA: { start: '090000', end: '130000' },
  POMERIGGIO: { start: '150000', end: '190000' },
};

/** Giorno romano di una Date come 'YYYYMMDD'. */
function giornoRoma(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return parts.replace(/-/g, '');
}

/** Link "Aggiungi a Google Calendar" per un richiamo. Nessun dato lascia PV finché non si clicca. */
export function googleCalendarUrl(input: {
  nome: string;
  tel?: string | null;
  citta?: string | null;
  giorno: Date;
  fascia: 'MATTINA' | 'POMERIGGIO' | null;
}): string {
  const g = giornoRoma(input.giorno);
  const params = new URLSearchParams({ action: 'TEMPLATE', text: `Richiamare ${input.nome}` });
  let dates: string;
  if (input.fascia) {
    const f = FASCE[input.fascia];
    dates = `${g}T${f.start}/${g}T${f.end}`;
    params.set('ctz', 'Europe/Rome');
  } else {
    const dopo = giornoRoma(new Date(input.giorno.getTime() + 24 * 60 * 60 * 1000));
    dates = `${g}/${dopo}`;
  }
  params.set('dates', dates);
  const dettagli = [
    input.tel ? `Tel: ${input.tel}` : null,
    input.citta ? `Città: ${input.citta}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  if (dettagli) params.set('details', dettagli);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
