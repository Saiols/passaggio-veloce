// Colori dei marker/cluster sulla mappa. Hex inline: Google Maps disegna i
// marker su canvas e non accetta classi Tailwind. Blu ≈ brand (broker),
// arancione per le agenzie.
export const DEALER_COLOR = '#1D4ED8';
export const AGENZIA_COLOR = '#EA580C';

export function pointColor(type: 'DEALER' | 'AGENZIA'): string {
  return type === 'DEALER' ? DEALER_COLOR : AGENZIA_COLOR;
}
