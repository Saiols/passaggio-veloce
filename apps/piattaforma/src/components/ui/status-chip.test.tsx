/**
 * Bug reale (review Task 9, distribuzione raggio v2): `status-chip.tsx`
 * ridichiarava a mano la union `PraticaStato` (10 literal) invece di derivarla
 * da `@pv/db`. Quando l'enum è cresciuto a 11 valori con `IN_DISTRIBUZIONE`,
 * ogni chiamante passava comunque `p.stato as PraticaStato` (un cast, non un
 * controllo): a runtime `styles['IN_DISTRIBUZIONE']` era `undefined` e
 * `styles[stato].cls` lanciava un TypeError su ~8 pagine (pratiche, inbox,
 * dashboard, admin). Qui si verifica che il render NON lanci per nessun
 * valore reale dell'enum e che un valore ignoto (dato malformato) degradi a
 * chip neutro invece di far esplodere la pagina.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PraticaStato as PRATICA_STATO } from '@pv/db';
import { StatusChip, type PraticaStato, type ChipViewerRole } from './status-chip';

const TUTTI = Object.values(PRATICA_STATO) as PraticaStato[];
const RUOLI: ChipViewerRole[] = ['BROKER', 'AGENZIA', 'ADMIN', 'GENERIC'];

describe('StatusChip — nessun valore dell’enum fa crashare il render', () => {
  it.each(TUTTI.flatMap((stato) => RUOLI.map((ruolo) => [stato, ruolo] as const)))(
    '%s per il viewer %s non lancia e produce una label non vuota',
    (stato, viewerRole) => {
      let html = '';
      expect(() => {
        html = renderToStaticMarkup(<StatusChip stato={stato} viewerRole={viewerRole} />);
      }).not.toThrow();
      expect(html).toMatch(/<span/);
      // Il testo della label sta dentro lo <span>: non è mai vuoto.
      expect(html.replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(0);
    },
  );

  it('IN_DISTRIBUZIONE (motore v2) è un chip valido: admin vede l’etichetta piena, broker/agenzia "In attesa"', () => {
    const admin = renderToStaticMarkup(<StatusChip stato="IN_DISTRIBUZIONE" viewerRole="ADMIN" />);
    expect(admin).toContain('In distribuzione');

    const broker = renderToStaticMarkup(<StatusChip stato="IN_DISTRIBUZIONE" viewerRole="BROKER" />);
    expect(broker).toContain('In attesa');
  });

  it('uno stato ignoto (dato malformato / cast a monte) degrada a chip neutro invece di crashare', () => {
    const statoIgnoto = 'QUALCOSA_DI_MAI_VISTO' as unknown as PraticaStato;
    let html = '';
    expect(() => {
      html = renderToStaticMarkup(<StatusChip stato={statoIgnoto} />);
    }).not.toThrow();
    // Chip neutro: stessa palette grigia di ANNULLATA/BOZZA, non una crash.
    expect(html).toContain('bg-pv-slate-100');
    expect(html).toContain('Sconosciuto');
  });
});
