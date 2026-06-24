import { describe, it, expect } from 'vitest';
import { EVENTO } from './tipi';
import {
  eventoNuovaPratica,
  eventoPraticaAccettata,
  eventoPraticaLavorata,
  eventoPraticaFirmata,
  eventoPraticaEscalation,
  eventoPraticaAssegnata,
  eventoPraticaAnnullata,
  eventoPraticaPenale,
} from './pratica-eventi';

const P = 'pratica-1';
const COD = 'PV-2026-00042';

describe('builder eventi pratica — target e tipo', () => {
  it('nuova pratica → target agenzia, CTA inbox', () => {
    const e = eventoNuovaPratica({ praticaId: P, agenziaId: 'ag-1', codicePratica: COD });
    expect(e.tipo).toBe(EVENTO.NUOVA_PRATICA);
    expect(e.targetCompanyId).toBe('ag-1');
    expect(e.ctaHref).toBe('/inbox');
    expect(e.testo).toContain(COD);
  });

  it('accettata → target broker, CTA alla pratica, nome agenzia nel testo', () => {
    const e = eventoPraticaAccettata({ praticaId: P, brokerId: 'br-1', codicePratica: COD, agenziaNome: 'Agenzia Rossi' });
    expect(e.tipo).toBe(EVENTO.PRATICA_ACCETTATA);
    expect(e.targetCompanyId).toBe('br-1');
    expect(e.ctaHref).toBe(`/pratiche/${P}`);
    expect(e.testo).toContain('Agenzia Rossi');
    expect(e.testo).toContain(COD);
  });

  it('accettata senza nome agenzia → fallback generico', () => {
    const e = eventoPraticaAccettata({ praticaId: P, brokerId: 'br-1', codicePratica: COD });
    expect(e.testo).toContain("Un'agenzia ha");
  });

  it('lavorata e firmata → target broker, CTA alla pratica', () => {
    const lav = eventoPraticaLavorata({ praticaId: P, brokerId: 'br-1', codicePratica: COD });
    const fir = eventoPraticaFirmata({ praticaId: P, brokerId: 'br-1', codicePratica: COD });
    expect(lav.tipo).toBe(EVENTO.PRATICA_LAVORATA);
    expect(fir.tipo).toBe(EVENTO.PRATICA_FIRMATA);
    for (const e of [lav, fir]) {
      expect(e.targetCompanyId).toBe('br-1');
      expect(e.ctaHref).toBe(`/pratiche/${P}`);
    }
  });

  it('escalation → target broker', () => {
    const e = eventoPraticaEscalation({ praticaId: P, brokerId: 'br-1', codicePratica: COD });
    expect(e.tipo).toBe(EVENTO.PRATICA_ESCALATION);
    expect(e.targetCompanyId).toBe('br-1');
  });

  it('assegnata da admin → target agenzia, CTA alla pratica', () => {
    const e = eventoPraticaAssegnata({ praticaId: P, agenziaId: 'ag-1', codicePratica: COD });
    expect(e.tipo).toBe(EVENTO.PRATICA_ASSEGNATA);
    expect(e.targetCompanyId).toBe('ag-1');
    expect(e.ctaHref).toBe(`/pratiche/${P}`);
  });

  it('annullata → target agenzia, nessuna CTA (solo chiusura)', () => {
    const e = eventoPraticaAnnullata({ praticaId: P, agenziaId: 'ag-1', codicePratica: COD });
    expect(e.tipo).toBe(EVENTO.PRATICA_ANNULLATA);
    expect(e.targetCompanyId).toBe('ag-1');
    expect(e.ctaHref).toBeNull();
    expect(e.ctaLabel).toBeNull();
  });

  it('targetSedeId: valorizzato se passato sedeId, altrimenti null', () => {
    expect(
      eventoNuovaPratica({ praticaId: P, agenziaId: 'ag-1', sedeId: 'sede-1', codicePratica: COD }).targetSedeId,
    ).toBe('sede-1');
    expect(
      eventoNuovaPratica({ praticaId: P, agenziaId: 'ag-1', codicePratica: COD }).targetSedeId,
    ).toBeNull();
    expect(
      eventoPraticaAccettata({ praticaId: P, brokerId: 'br-1', sedeId: 'sede-2', codicePratica: COD })
        .targetSedeId,
    ).toBe('sede-2');
  });

  it('penale → titolo diverso per broker e agenzia, target corretto', () => {
    const broker = eventoPraticaPenale({ praticaId: P, targetCompanyId: 'br-1', codicePratica: COD, ruolo: 'broker' });
    const agenzia = eventoPraticaPenale({ praticaId: P, targetCompanyId: 'ag-1', codicePratica: COD, ruolo: 'agenzia' });
    expect(broker.tipo).toBe(EVENTO.PRATICA_PENALE);
    expect(broker.targetCompanyId).toBe('br-1');
    expect(broker.titolo).toBe('Penale addebitata');
    expect(agenzia.targetCompanyId).toBe('ag-1');
    expect(agenzia.titolo).toBe('Segnalazione confermata');
  });
});
