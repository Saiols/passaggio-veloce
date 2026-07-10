import type { PraticaTipo } from '@pv/db';

/**
 * Etichetta tipologia pratica per liste/card/chip. "Multiplo" = più veicoli,
 * ortogonale al tipo (vale sia per SEMPLICE sia per MINIVOLTURA).
 */
export function labelTipoPratica(p: { tipo: PraticaTipo; numeroVeicoli: number }): string {
  const multiplo = p.numeroVeicoli > 1;
  if (p.tipo === 'SEMPLICE') return multiplo ? 'Semplice Multiplo' : 'Semplice';
  return multiplo ? 'Minivoltura multipla' : 'Minivoltura';
}
