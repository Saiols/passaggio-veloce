/** Costruisce un href `tel:` da un numero libero. null se non resta nulla di componibile. */
export function telHref(tel: string): string | null {
  const cleaned = (tel ?? '').replace(/[^\d+]/g, '');
  return cleaned ? `tel:${cleaned}` : null;
}
