import { describe, it, expect } from 'vitest';
import { gruppiBroker, gruppiAgenzia, type NavInput } from './nav-voci';
import { iconaComponente } from './nav-icone';

/**
 * `iconaComponente` LANCIA su una chiave non registrata (scelta deliberata,
 * v. il commento in nav-icone.tsx): il costo è che una voce nuova con
 * un'icona nuova non rompe nessun test unitario — rompe la sidebar a runtime,
 * e solo per il ruolo che vede quella voce. Qui si chiude il giro: ogni chiave
 * `icona` prodotta dalle due funzioni di nav deve risolvere.
 *
 * Input massimale (owner, tutto abilitato): serve la nav più larga possibile,
 * altrimenti le voci filtrate non verrebbero mai controllate.
 */
const INPUT_MASSIMALE: NavInput = {
  isOwner: true,
  permessi: [],
  puoGestireTeam: true,
  soloLettura: false,
};

describe('iconaComponente copre tutte le voci di nav', () => {
  it.each([
    ['gruppiBroker', gruppiBroker],
    ['gruppiAgenzia', gruppiAgenzia],
  ])('%s: ogni chiave icona è registrata', (_nome, fn) => {
    const icone = fn(INPUT_MASSIMALE).flatMap((g) => g.items.map((i) => i.icona));
    expect(icone.length).toBeGreaterThan(0);
    for (const icona of icone) {
      expect(() => iconaComponente(icona), `chiave icona "${icona}"`).not.toThrow();
    }
  });
});
