import { describe, it, expect } from 'vitest';
import {
  calcolaArricchimento,
  campiVuoti,
  normDaPatch,
  unisciArricchitoDa,
  type ContattoDaArricchire,
  type SorgenteArricchimento,
} from './arricchimento';

const VUOTO: ContattoDaArricchire = {
  email: null, wa: null, piva: null,
  indirizzo: null, citta: null, cap: null, regione: null,
};

const SORGENTE: SorgenteArricchimento = {
  company: {
    email: 'info@agenziacorsico.it',
    telefono: '02 4478712',
    partitaIva: '01234567890',
    indirizzo: 'Via Fiume',
    civico: '6',
    citta: 'Corsico',
    cap: '20094',
    provincia: 'MI',
  },
  sede: null,
};

describe('calcolaArricchimento', () => {
  it('contatto vuoto → riempie tutto quello che può', () => {
    const patch = calcolaArricchimento(VUOTO, SORGENTE)!;
    expect(patch.dati).toEqual({
      email: 'info@agenziacorsico.it',
      piva: '01234567890',
      indirizzo: 'Via Fiume 6',
      citta: 'Corsico',
      cap: '20094',
      regione: 'Lombardia',
    });
    // `wa` assente: 02 4478712 è un fisso, non un numero WhatsApp.
    expect(patch.campi).toEqual(['email', 'piva', 'indirizzo', 'citta', 'cap', 'regione']);
  });

  it('campo già valorizzato → non si tocca', () => {
    const patch = calcolaArricchimento(
      { ...VUOTO, email: 'commerciale@agenziacorsico.it', citta: 'CORSICO' },
      SORGENTE,
    )!;
    expect(patch.dati.email).toBeUndefined();
    expect(patch.dati.citta).toBeUndefined();
  });

  it('campo di soli spazi conta come vuoto', () => {
    const patch = calcolaArricchimento({ ...VUOTO, email: '   ' }, SORGENTE)!;
    expect(patch.dati.email).toBe('info@agenziacorsico.it');
  });

  it('email arricchita viene abbassata di case, come ogni altro write path del CRM', () => {
    const patch = calcolaArricchimento(VUOTO, {
      ...SORGENTE,
      company: { ...SORGENTE.company, email: 'Info@AgenziaCorsico.IT' },
    })!;
    expect(patch.dati.email).toBe('info@agenziacorsico.it');
  });

  it('match su sede: vincono i dati della sede', () => {
    const patch = calcolaArricchimento(VUOTO, {
      ...SORGENTE,
      sede: {
        email: 'buccinasco@agenziacorsico.it',
        telefono: null,
        indirizzo: 'Viale Lombardia',
        civico: '12',
        citta: 'Buccinasco',
        cap: '20090',
        provincia: 'MI',
      },
    })!;
    expect(patch.dati.email).toBe('buccinasco@agenziacorsico.it');
    expect(patch.dati.indirizzo).toBe('Viale Lombardia 12');
    expect(patch.dati.citta).toBe('Buccinasco');
    expect(patch.dati.cap).toBe('20090');
    // la P.IVA è solo della madre: la sede non ne ha una
    expect(patch.dati.piva).toBe('01234567890');
  });

  it('sede senza email → scende alla madre', () => {
    const patch = calcolaArricchimento(VUOTO, {
      ...SORGENTE,
      sede: {
        email: null, telefono: null,
        indirizzo: 'Viale Lombardia', civico: '12',
        citta: 'Buccinasco', cap: '20090', provincia: 'MI',
      },
    })!;
    expect(patch.dati.email).toBe('info@agenziacorsico.it');
  });

  it('la PEC non finisce mai in email', () => {
    // La PEC non è nemmeno nel tipo sorgente: il test lo fissa passandola
    // come campo in più e verificando che non venga usata.
    const conPec = {
      ...SORGENTE,
      company: { ...SORGENTE.company, email: '', pec: 'agenziacorsico@pec.it' },
    } as unknown as SorgenteArricchimento;
    const patch = calcolaArricchimento(VUOTO, conPec)!;
    expect(patch.dati.email).toBeUndefined();
  });

  it('wa riempito solo con un cellulare', () => {
    const mobile = calcolaArricchimento(VUOTO, {
      ...SORGENTE,
      company: { ...SORGENTE.company, telefono: '+39 333 1234567' },
    })!;
    expect(mobile.dati.wa).toBe('+39 333 1234567');

    const fisso = calcolaArricchimento(VUOTO, SORGENTE)!;
    expect(fisso.dati.wa).toBeUndefined();
  });

  it('wa: se la sede ha il fisso e la madre il cellulare, prende il cellulare', () => {
    const patch = calcolaArricchimento(VUOTO, {
      company: { ...SORGENTE.company, telefono: '333 1234567' },
      sede: {
        email: null, telefono: '02 4478712',
        indirizzo: 'Viale Lombardia', civico: null,
        citta: 'Buccinasco', cap: '20090', provincia: 'MI',
      },
    })!;
    expect(patch.dati.wa).toBe('333 1234567');
  });

  it('indirizzo senza civico non porta spazi in coda', () => {
    const patch = calcolaArricchimento(VUOTO, {
      ...SORGENTE,
      company: { ...SORGENTE.company, civico: null },
    })!;
    expect(patch.dati.indirizzo).toBe('Via Fiume');
  });

  it('provincia ignota → regione non scritta', () => {
    const patch = calcolaArricchimento(VUOTO, {
      ...SORGENTE,
      company: { ...SORGENTE.company, provincia: 'XX' },
    })!;
    expect(patch.dati.regione).toBeUndefined();
    expect(patch.campi).not.toContain('regione');
  });

  it('valore sorgente vuoto → campo non scritto', () => {
    const patch = calcolaArricchimento(VUOTO, {
      ...SORGENTE,
      company: { ...SORGENTE.company, email: '' },
    })!;
    expect(patch.dati.email).toBeUndefined();
  });

  it('contatto completo → null, così il chiamante non scrive nulla', () => {
    expect(
      calcolaArricchimento(
        {
          email: 'a@b.it', wa: '3331234567', piva: '01234567890',
          indirizzo: 'Via Fiume 6', citta: 'Corsico', cap: '20094',
          regione: 'Lombardia',
        },
        SORGENTE,
      ),
    ).toBeNull();
  });
});

describe('campiVuoti', () => {
  it('elenca i buchi in ordine canonico', () => {
    expect(campiVuoti({ ...VUOTO, email: 'a@b.it', citta: '  ' })).toEqual([
      'wa', 'piva', 'indirizzo', 'citta', 'cap', 'regione',
    ]);
  });

  it('contatto pieno → nessun buco', () => {
    expect(
      campiVuoti({
        email: 'a@b.it', wa: '3331234567', piva: '01234567890',
        indirizzo: 'Via Fiume 6', citta: 'Corsico', cap: '20094',
        regione: 'Lombardia',
      }),
    ).toEqual([]);
  });
});

describe('normDaPatch', () => {
  it('normalizza solo i campi scritti — mai telNorm', () => {
    const norm = normDaPatch({
      dati: { email: ' INFO@Agenzia.IT ', citta: 'Corsico' },
      campi: ['email', 'citta'],
    });
    expect(norm).toEqual({ emailNorm: 'info@agenzia.it' });
    expect(norm).not.toHaveProperty('telNorm');
    expect(norm).not.toHaveProperty('pivaNorm');
  });

  it('un valore non normalizzabile dà null, non stringa vuota', () => {
    const norm = normDaPatch({ dati: { piva: 'N/D' }, campi: ['piva'] });
    expect(norm).toEqual({ pivaNorm: null });
  });
});

describe('unisciArricchitoDa', () => {
  it('primo arricchimento', () => {
    expect(unisciArricchitoDa(null, ['email', 'citta'])).toBe('email,citta');
  });

  it('unisce al precedente senza duplicati e in ordine canonico', () => {
    expect(unisciArricchitoDa('citta,email', ['wa', 'email'])).toBe('email,wa,citta');
  });
});
