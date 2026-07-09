import { describe, it, expect } from 'vitest';
import { PRATICHE_GRID } from './table-grid';

/**
 * Estrae, per ogni breakpoint dichiarato nella stringa di classe, quante tracce
 * definisce. `minmax(0,1fr)` non contiene underscore, quindi lo split è sicuro.
 */
function traccePerBreakpoint(cls: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const token of cls.split(/\s+/).filter(Boolean)) {
    const m = /^(?:(sm|md|lg):)?grid-cols-\[(.+)\]$/.exec(token);
    if (!m) throw new Error(`token non riconosciuto: ${token}`);
    out[m[1] ?? 'base'] = m[2].split('_').length;
  }
  return out;
}

describe('PRATICHE_GRID — le tracce combaciano con le celle visibili', () => {
  it('utenteSenzaSede: 4 → +proprietario → +controparte → +fee', () => {
    expect(traccePerBreakpoint(PRATICHE_GRID.utenteSenzaSede)).toEqual({
      base: 4,
      sm: 5,
      md: 6,
      lg: 7,
    });
  });

  it('utenteConSede: come utenteSenzaSede, con una traccia in più su lg', () => {
    expect(traccePerBreakpoint(PRATICHE_GRID.utenteConSede)).toEqual({
      base: 4,
      sm: 5,
      md: 6,
      lg: 8,
    });
  });

  it('admin: nessuna colonna nuova su sm, broker+agenzia da md, fee da lg', () => {
    expect(traccePerBreakpoint(PRATICHE_GRID.admin)).toEqual({
      base: 4,
      sm: 4,
      md: 6,
      lg: 7,
    });
  });
});

describe('PRATICHE_GRID — nessuna traccia dipende dal contenuto', () => {
  // È la causa originale del disallineamento: con `auto` ogni riga si dimensiona
  // sul proprio contenuto e non combacia né con l'header né con le altre righe.
  it.each(Object.entries(PRATICHE_GRID))('%s non usa `auto`', (_nome, cls) => {
    expect(cls).not.toMatch(/auto/);
  });
});
