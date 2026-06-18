/**
 * Costruzione querystring (senza '?') per i link di filtro e pagination della
 * tabella contatti CRM. Pura e condivisa tra updateFilter, pageHref e chip.
 * Omette valori vuoti, il sort di default ('recente') e page <= 1.
 */
export type ContactsQueryParams = {
  q?: string;
  cat?: string;
  status?: string;
  regione?: string;
  assigned?: string;
  sort?: string; // 'recente' (default) | 'nome'
  preset?: string; // 'urgenti' | ''
  page?: number; // 1-based
};

export function buildContactsQuery(p: ContactsQueryParams): string {
  const sp = new URLSearchParams();
  if (p.q) sp.set('q', p.q);
  if (p.cat) sp.set('cat', p.cat);
  if (p.status) sp.set('status', p.status);
  if (p.regione) sp.set('regione', p.regione);
  if (p.assigned) sp.set('assigned', p.assigned);
  if (p.sort && p.sort !== 'recente') sp.set('sort', p.sort);
  if (p.preset) sp.set('preset', p.preset);
  if (p.page && p.page > 1) sp.set('page', String(p.page));
  return sp.toString();
}
