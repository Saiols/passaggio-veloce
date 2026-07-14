/**
 * Test di integrazione: verifica che tutti i template usino il nuovo layout
 * istituzionale (emailLayout) e che N31 usi il bottone CTA arancio.
 */

import { describe, it, expect } from 'vitest';
import { tplN1BrokerInvio, tplN31ValutaAgenzia, tplN40ClienteAvanzamento, tplN9AgenziaAddebitoFallito, tplN41AdminNuovaSegnalazione, tplN42BrokerSegnalazioneGestita, tplN4BrokerFirma, tplN8AgenziaAddebito } from './templates';
import type { ClienteAvanzamentoStato, ClienteAvanzamentoRuolo } from './templates';
import { formatDate } from '@/lib/format';

describe('templates usano il nuovo layout', () => {
  it('N1 contiene header navy, logo, footer legale', () => {
    const { html } = tplN1BrokerInvio({
      codicePratica: 'PV-1', targa: 'AB123CD', comune: 'Milano', provincia: 'MI',
      numeroAgenzie: 5, nomeBroker: 'Mario',
    });
    expect(html).toContain('logo-email.png');
    expect(html).toContain('Passaggio Veloce SRL');
    expect(html).toContain('<!--PV_UNSUB-->');
  });

  it('N31 usa il bottone CTA arancio verso praticaUrl', () => {
    const { html } = tplN31ValutaAgenzia({
      codicePratica: 'PV-1', targa: null, agenziaNome: 'Ag', nomeBroker: 'Mario',
      praticaUrl: 'https://passaggioveloce.it/pratiche/1',
    });
    expect(html).toContain('https://passaggioveloce.it/pratiche/1');
    expect(html).toContain('#ff7a00');
  });
});

describe('N40 cliente avanzamento', () => {
  const STATI: ClienteAvanzamentoStato[] = [
    'AVVIATA', 'PRESA_IN_CARICO', 'PRONTA_FIRMA', 'COMPLETATA', 'ANNULLATA',
  ];
  const RUOLI: ClienteAvanzamentoRuolo[] = ['ACQUIRENTE', 'VENDITORE'];

  it('per ogni stato/ruolo: subject e text valorizzati, niente dati commerciali', () => {
    for (const stato of STATI) {
      for (const ruolo of RUOLI) {
        const { subject, text, html } = tplN40ClienteAvanzamento({
          codicePratica: 'PV-2026-001',
          veicoloDescrizione: 'AB123CD',
          nomeDestinatario: 'Mario Rossi',
          ruolo,
          stato,
        });
        expect(subject.length).toBeGreaterThan(0);
        expect(text.length).toBeGreaterThan(0);
        expect(subject).toContain('PV-2026-001');
        expect(text).toContain('PV-2026-001');
        // niente dati commerciali
        // niente dati commerciali (il template non riceve fee/importi/nome
        // agenzia: la menzione generica "un'agenzia partner" è consentita).
        const haystack = `${subject}\n${text}\n${html}`.toLowerCase();
        expect(haystack).not.toContain('€');
        expect(haystack).not.toContain('fee');
        expect(haystack).not.toContain('wallet');
        expect(haystack).not.toContain('saldo');
      }
    }
  });

  it('differenzia acquisto vs vendita all-avvio', () => {
    const base = {
      codicePratica: 'PV-1', veicoloDescrizione: 'AB123CD', nomeDestinatario: 'Mario',
      stato: 'AVVIATA' as const,
    };
    const acq = tplN40ClienteAvanzamento({ ...base, ruolo: 'ACQUIRENTE' });
    const ven = tplN40ClienteAvanzamento({ ...base, ruolo: 'VENDITORE' });
    expect(acq.text.toLowerCase()).toContain('acquisto');
    expect(ven.text.toLowerCase()).toContain('vendita');
  });

  it('gestisce veicoloDescrizione null senza rompere', () => {
    const { text } = tplN40ClienteAvanzamento({
      codicePratica: 'PV-1', veicoloDescrizione: null, nomeDestinatario: 'Mario',
      ruolo: 'ACQUIRENTE', stato: 'COMPLETATA',
    });
    expect(text).toContain('PV-1');
    expect(text).not.toContain('null');
  });

  it('PRESA_IN_CARICO con agenzia: indica dove recarsi (indirizzo) + documenti originali', () => {
    const { text, html } = tplN40ClienteAvanzamento({
      codicePratica: 'PV-2026-009',
      veicoloDescrizione: 'AB123CD',
      nomeDestinatario: 'Mario Rossi',
      ruolo: 'ACQUIRENTE',
      stato: 'PRESA_IN_CARICO',
      agenziaNome: 'Agenzia Corsico',
      agenziaIndirizzo: 'Via Roma 1',
      agenziaCap: '20094',
      agenziaCitta: 'Corsico',
      agenziaProvincia: 'MI',
    });
    expect(text).toContain('Via Roma 1');
    expect(text).toContain('Corsico');
    expect(text.toLowerCase()).toContain('documenti originali');
    expect(html).toContain('Via Roma 1');
    expect(html).toContain('Agenzia Corsico');
    expect(html).toContain('20094 Corsico (MI)');
  });

  it('COMPLETATA con agenzia: mostra la SEDE della firma (nome + indirizzo), senza "dove recarti"/documenti originali', () => {
    const { text, html } = tplN40ClienteAvanzamento({
      codicePratica: 'PV-2026-011',
      veicoloDescrizione: 'AB123CD',
      nomeDestinatario: 'Mario Rossi',
      ruolo: 'VENDITORE',
      stato: 'COMPLETATA',
      agenziaNome: 'Agenzia Corsico',
      agenziaIndirizzo: 'Via Roma 1',
      agenziaCap: '20094',
      agenziaCitta: 'Corsico',
      agenziaProvincia: 'MI',
    });
    expect(text).toContain('Agenzia Corsico');
    expect(text).toContain('Via Roma 1');
    expect(text).toContain('20094 Corsico (MI)');
    expect(html).toContain('Sede della firma');
    expect(html).toContain('Agenzia Corsico');
    expect(html).toContain('20094 Corsico (MI)');
    // L'email finale NON usa il linguaggio "dove recarti"/documenti originali.
    const hay = `${text}\n${html}`.toLowerCase();
    expect(hay).not.toContain('dove recarti');
    expect(hay).not.toContain('documenti originali');
  });

  it('non mostra l\'indirizzo agenzia quando non c\'è agenzia (es. AVVIATA)', () => {
    const { text, html } = tplN40ClienteAvanzamento({
      codicePratica: 'PV-2026-010', veicoloDescrizione: 'AB123CD',
      nomeDestinatario: 'Mario Rossi', ruolo: 'VENDITORE', stato: 'AVVIATA',
    });
    expect(`${text}\n${html}`).not.toContain('Via Roma');
    expect(`${text}\n${html}`.toLowerCase()).not.toContain('dove recarti');
  });

  it('ogni stato porta con sé il link all\'informativa privacy per i clienti', () => {
    // Art. 14 GDPR: l'informativa va resa al più tardi alla prima
    // comunicazione all'interessato. La N40 È quella comunicazione: se il
    // link cade da una variante, quella variante viola l'articolo.
    for (const stato of STATI) {
      const { text, html } = tplN40ClienteAvanzamento({
        codicePratica: 'PV-2026-100',
        veicoloDescrizione: 'AB123CD',
        nomeDestinatario: 'Mario Rossi',
        ruolo: 'VENDITORE',
        stato,
      });
      expect(text, `text/${stato}`).toContain('/privacy/clienti');
      expect(html, `html/${stato}`).toContain('/privacy/clienti');
    }
  });

  it('AVVIATA: dice da CHI abbiamo ricevuto i dati (il broker), che è il punto dell\'art. 14', () => {
    const { text, html } = tplN40ClienteAvanzamento({
      codicePratica: 'PV-2026-101',
      veicoloDescrizione: 'AB123CD',
      nomeDestinatario: 'Mario Rossi',
      ruolo: 'ACQUIRENTE',
      stato: 'AVVIATA',
      nomeBroker: 'Autosalone Bianchi S.r.l.',
    });
    expect(text).toContain('Autosalone Bianchi S.r.l.');
    expect(html).toContain('Autosalone Bianchi S.r.l.');
  });

  it('AVVIATA senza nomeBroker: nessun buco di testo, il link resta', () => {
    // nomeBroker è opzionale: se la select fallisse o la company fosse
    // sparita non dobbiamo scrivere "trasmessi da undefined".
    const { text, html } = tplN40ClienteAvanzamento({
      codicePratica: 'PV-2026-102',
      veicoloDescrizione: null,
      nomeDestinatario: 'Mario Rossi',
      ruolo: 'VENDITORE',
      stato: 'AVVIATA',
    });
    expect(text).not.toContain('undefined');
    expect(html).not.toContain('undefined');
    expect(text).not.toContain('null');
    expect(text).toContain('/privacy/clienti');
  });
});

describe('N9 addebito fallito agenzia', () => {
  it('contiene il messaggio di limitazione operativa, l\'invito a aggiornare l\'IBAN e il CTA', () => {
    const { subject, text, html } = tplN9AgenziaAddebitoFallito({
      nomeAgenzia: 'Agenzia Rossi',
      rimedioUrl: 'https://passaggioveloce.it/blocco-pagamento',
    });
    expect(subject.length).toBeGreaterThan(0);
    const hay = `${subject}\n${text}\n${html}`.toLowerCase();
    expect(hay).toContain('addebito');
    expect(hay).toContain('iban');
    expect(hay).toContain('operatività');
    expect(hay).toContain('accesso');
    expect(html).toContain('https://passaggioveloce.it/blocco-pagamento');
  });
});

describe('N41 admin nuova segnalazione creazione', () => {
  it('mette oggetto + link admin e cita azienda e step', () => {
    const out = tplN41AdminNuovaSegnalazione({
      segnalazioneId: 's1',
      ragioneSociale: 'Auto Rossi',
      step: 2,
      tipo: 'LETTURA_DATI',
      estratto: 'La targa è stata letta male',
    });
    expect(out.subject).toMatch(/segnalazione/i);
    expect(out.html).toContain('Auto Rossi');
    expect(out.html).toContain('/admin/segnalazioni');
  });
});

describe('N42 broker segnalazione gestita', () => {
  it('include la nota di risposta', () => {
    const out = tplN42BrokerSegnalazioneGestita({ nota: 'La targa corretta è AB123CD', nomeBroker: 'Mario' });
    expect(out.html).toContain('La targa corretta è AB123CD');
  });
});

describe('N4 — firma attestata dal Gestore (Termini art. 11)', () => {
  const n4 = {
    codicePratica: 'PV-001',
    targa: 'AB123CD',
    agenziaNome: 'Agenzia Rossi',
    creditoCent: 5000,
    saldoCent: 12000,
    nomeBroker: 'Mario',
  };

  it('firma normale: dice che l\'agenzia ha confermato (retrocompatibilità)', () => {
    const out = tplN4BrokerFirma(n4);
    expect(out.text).toContain('Agenzia Rossi ha confermato la firma');
    expect(out.text).not.toContain('team Passaggio Veloce');
    expect(out.html).not.toContain('team Passaggio Veloce');
  });

  it('firma attestata: NON dice più che l\'agenzia ha confermato (sarebbe falso)', () => {
    const out = tplN4BrokerFirma({ ...n4, attestataDaPv: true });
    expect(out.text).not.toContain('Agenzia Rossi ha confermato');
    expect(out.text).toContain('team Passaggio Veloce');
    expect(out.html).not.toContain('Agenzia Rossi</strong> ha confermato');
    expect(out.html).toContain('team Passaggio Veloce');
  });

  it('firma attestata: non espone la motivazione interna dell\'attestazione', () => {
    const out = tplN4BrokerFirma({ ...n4, attestataDaPv: true });
    expect(out.text.toLowerCase()).not.toContain('motivo');
    expect(out.html.toLowerCase()).not.toContain('motivo');
  });

  it('firma attestata con data: riporta la data dell\'attestazione (art. 11 — decorrenza contestazione)', () => {
    const attestataDaPvAt = new Date('2026-07-13T10:00:00Z');
    const out = tplN4BrokerFirma({ ...n4, attestataDaPv: true, attestataDaPvAt });
    const dataAttesa = formatDate(attestataDaPvAt);
    expect(out.text).toContain(dataAttesa);
    expect(out.html).toContain(dataAttesa);
  });

  it('firma attestata senza data (retrocompatibilità): non rompe, semplicemente non la riporta', () => {
    const out = tplN4BrokerFirma({ ...n4, attestataDaPv: true });
    expect(out.text).toContain('avendone avuto conferma');
    expect(out.html).toContain('avendone avuto conferma');
  });
});

describe('N8 — addebito agenzia con firma attestata dal Gestore (Termini art. 11)', () => {
  const n8 = {
    codicePratica: 'PV-001',
    feeCent: 3000,
    autoAddebitoAt: new Date('2026-07-13T10:00:00Z'),
    nomeAgenzia: 'Agenzia Rossi',
  };

  it('firma normale: nessuna menzione dell\'attestazione (retrocompatibilità)', () => {
    const out = tplN8AgenziaAddebito(n8);
    expect(out.text).not.toContain('team Passaggio Veloce');
    expect(out.html).not.toContain('team Passaggio Veloce');
  });

  it('firma attestata: informa l\'agenzia di chi ha registrato la firma, cita la clausola 11 e i 15 giorni per contestare', () => {
    const out = tplN8AgenziaAddebito({ ...n8, attestataDaPv: true });
    expect(out.text).toContain('team Passaggio Veloce');
    expect(out.text).toContain('clausola 11');
    expect(out.text).toContain('15 giorni');
    expect(out.html).toContain('team Passaggio Veloce');
    expect(out.html).toContain('clausola 11');
    expect(out.html).toContain('15 giorni');
  });

  it('firma attestata con data: riporta la data dell\'attestazione (art. 11 — decorrenza contestazione)', () => {
    const attestataDaPvAt = new Date('2026-07-13T10:00:00Z');
    const out = tplN8AgenziaAddebito({ ...n8, attestataDaPv: true, attestataDaPvAt });
    const dataAttesa = formatDate(attestataDaPvAt);
    expect(out.text).toContain(dataAttesa);
    expect(out.html).toContain(dataAttesa);
  });
});
