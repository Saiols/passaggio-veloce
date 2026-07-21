import { describe, it, expect } from 'vitest';
import {
  giorniCalendarioTrascorsi,
  fermaLevel,
  categoriaMonitoraggio,
  dataFermaDa,
  CATEGORIA_MONITORAGGIO_LABEL,
} from './giorni-fermi';

describe('giorniCalendarioTrascorsi', () => {
  it('null se from è null', () => {
    expect(giorniCalendarioTrascorsi(null, new Date('2026-07-17T12:00:00Z'))).toBeNull();
  });
  it('stesso giorno di calendario Roma → 0', () => {
    expect(
      giorniCalendarioTrascorsi(new Date('2026-07-17T06:00:00Z'), new Date('2026-07-17T20:00:00Z')),
    ).toBe(0);
  });
  it('conta i confini di mezzanotte, non i periodi di 24h', () => {
    // from = 2026-07-14 (Roma), now = 2026-07-17 (Roma) → 3 giorni di calendario
    expect(
      giorniCalendarioTrascorsi(new Date('2026-07-14T12:00:00Z'), new Date('2026-07-17T09:00:00Z')),
    ).toBe(3);
  });
  it('mezzanotte Roma: 23:30Z del 16 è già il 17 a Roma (estate +2)', () => {
    // from Roma 2026-07-17 01:30, now Roma 2026-07-19 10:00 → 2 giorni
    expect(
      giorniCalendarioTrascorsi(new Date('2026-07-16T23:30:00Z'), new Date('2026-07-19T08:00:00Z')),
    ).toBe(2);
  });
});

describe('fermaLevel', () => {
  it('rosso a ≥3, ambra a 2, neutro sotto, ok se null', () => {
    expect(fermaLevel(null)).toBe('ok');
    expect(fermaLevel(0)).toBe('ok');
    expect(fermaLevel(1)).toBe('ok');
    expect(fermaLevel(2)).toBe('warn');
    expect(fermaLevel(3)).toBe('urgent');
    expect(fermaLevel(9)).toBe('urgent');
  });
});

describe('categoriaMonitoraggio', () => {
  it('ACCETTATA non lavorata → ACCETTATA_FERMA', () => {
    expect(
      categoriaMonitoraggio({ stato: 'ACCETTATA', processataAt: null, zonaNonCopertaAt: null }),
    ).toBe('ACCETTATA_FERMA');
  });

  it('ACCETTATA già lavorata (processataAt valorizzato) → nessuna categoria', () => {
    // Non è più "ferma": l'agenzia l'ha lavorata, in attesa solo della firma.
    expect(
      categoriaMonitoraggio({
        stato: 'ACCETTATA',
        processataAt: new Date('2026-07-17'),
        zonaNonCopertaAt: null,
      }),
    ).toBeNull();
  });

  it('IN_DISTRIBUZIONE con zonaNonCopertaAt valorizzato → ZONA_NON_COPERTA', () => {
    expect(
      categoriaMonitoraggio({
        stato: 'IN_DISTRIBUZIONE',
        processataAt: null,
        zonaNonCopertaAt: new Date('2026-07-18'),
      }),
    ).toBe('ZONA_NON_COPERTA');
  });

  it('IN_DISTRIBUZIONE ancora in espansione (zonaNonCopertaAt null) → nessuna categoria', () => {
    // Il motore sta ancora ciclando normalmente: non è "ferma", non va nel
    // monitoraggio (eviterebbe rumore per ogni pratica appena inviata).
    expect(
      categoriaMonitoraggio({ stato: 'IN_DISTRIBUZIONE', processataAt: null, zonaNonCopertaAt: null }),
    ).toBeNull();
  });

  it('altri stati (PROCESSATA, FIRMATA, BOZZA, …) → nessuna categoria', () => {
    for (const stato of ['PROCESSATA', 'FIRMATA', 'BOZZA', 'ANNULLATA', 'SCADUTA'] as const) {
      expect(categoriaMonitoraggio({ stato, processataAt: null, zonaNonCopertaAt: null })).toBeNull();
    }
  });

  it('le due categorie non si sovrappongono mai per costruzione', () => {
    // zonaNonCopertaAt vive solo su IN_DISTRIBUZIONE: un'ACCETTATA con
    // zonaNonCopertaAt "residuo" (dato legacy/inatteso) resta comunque
    // ACCETTATA_FERMA, non ZONA_NON_COPERTA — lo stato governa, non il campo.
    expect(
      categoriaMonitoraggio({
        stato: 'ACCETTATA',
        processataAt: null,
        zonaNonCopertaAt: new Date('2026-07-01'),
      }),
    ).toBe('ACCETTATA_FERMA');
  });
});

describe('dataFermaDa', () => {
  it('ACCETTATA_FERMA usa accettataAt', () => {
    const accettataAt = new Date('2026-07-15');
    expect(dataFermaDa({ accettataAt, zonaNonCopertaAt: null }, 'ACCETTATA_FERMA')).toBe(accettataAt);
  });

  it('ZONA_NON_COPERTA usa zonaNonCopertaAt', () => {
    const zonaNonCopertaAt = new Date('2026-07-18');
    expect(dataFermaDa({ accettataAt: null, zonaNonCopertaAt }, 'ZONA_NON_COPERTA')).toBe(
      zonaNonCopertaAt,
    );
  });
});

describe('CATEGORIA_MONITORAGGIO_LABEL', () => {
  it('ha un’etichetta leggibile per entrambe le categorie', () => {
    expect(CATEGORIA_MONITORAGGIO_LABEL.ACCETTATA_FERMA).toBe('Accettata, ferma');
    expect(CATEGORIA_MONITORAGGIO_LABEL.ZONA_NON_COPERTA).toBe('Zona non coperta');
  });
});
