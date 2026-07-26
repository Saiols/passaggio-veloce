/**
 * Test di integrazione: verifica che tutti i template usino il nuovo layout
 * istituzionale (emailLayout) e che N31 usi il bottone CTA arancio.
 */

import { describe, it, expect } from 'vitest';
import { tplN1BrokerInvio, tplN26EmailPartenza, tplN31ValutaAgenzia, tplN40ClienteAvanzamento, tplN9AgenziaAddebitoFallito, tplN41AdminNuovaSegnalazione, tplN42BrokerSegnalazioneGestita, tplN4BrokerFirma, tplN8AgenziaAddebito, tplN46VisuraInScadenza, tplN47VisuraScaduta, tplN48BrokerPraticaCongelata, tplN49AdminAtecoNonIdoneo, tplN52BrokerZonaNonCoperta } from './templates';
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
    fatturaAllegata: true,
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

describe('N26 email di partenza', () => {
  const base = {
    nomeReferente: 'Mario Rossi',
    messaggio:
      'come d\'accordo, ecco il link per Autosalone Rossi Srl.\n\nRicevi pratiche già complete e verificate dalla tua provincia.',
    linkUrl: 'https://passaggioveloce.it/i/tok123',
    unsubUrl: 'https://passaggioveloce.it/unsubscribe?token=uns123',
  } as const;

  it('broker: CTA concessionaria + saluto + link + layout', () => {
    const { html, subject, text } = tplN26EmailPartenza({ ...base, categoria: 'BROKER' });
    expect(subject.toLowerCase()).toContain('registrarti');
    expect(html).toContain('Registra la tua concessionaria');
    expect(html).toContain('Buongiorno Mario Rossi'); // saluto dal nomeReferente
    expect(html).toContain('https://passaggioveloce.it/i/tok123');
    expect(html).toContain('logo-email.png'); // layout istituzionale
  });

  it('agenzia: CTA agenzia (etichetta guidata dalla categoria)', () => {
    const { html } = tplN26EmailPartenza({ ...base, categoria: 'AGENZIA' });
    expect(html).toContain('Registra la tua agenzia');
  });

  it('rende il messaggio custom in HTML e testo', () => {
    const { html, text } = tplN26EmailPartenza({
      ...base,
      categoria: 'BROKER',
      messaggio: 'Ciao, testo personalizzato per te.\n\nSeconda frase su misura.',
    });
    expect(html).toContain('Ciao, testo personalizzato per te.');
    expect(html).toContain('Seconda frase su misura.');
    expect(text).toContain('Ciao, testo personalizzato per te.');
    expect(text).toContain('Seconda frase su misura.');
  });

  it('riga vuota = nuovo paragrafo, singolo a-capo = <br>', () => {
    const { html } = tplN26EmailPartenza({
      ...base,
      categoria: 'BROKER',
      messaggio: 'Primo paragrafo.\n\nRiga uno\nRiga due',
    });
    // due paragrafi distinti
    expect(html.match(/<p[^>]*>Primo paragrafo\.<\/p>/)).toBeTruthy();
    // singolo a-capo dentro un paragrafo → <br>
    expect(html).toContain('Riga uno<br>Riga due');
  });

  it('escapa HTML pericoloso nel messaggio custom (no XSS stored)', () => {
    const { html } = tplN26EmailPartenza({
      ...base,
      categoria: 'BROKER',
      messaggio: '<script>alert(1)</script> & <b>grassetto</b>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<b>grassetto</b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('senza codice: nessun blocco credito, nessun simbolo €', () => {
    const { html, text } = tplN26EmailPartenza({ ...base, categoria: 'BROKER' });
    expect(html).not.toContain('credito di benvenuto');
    expect(text).not.toContain('€');
    expect(html).not.toContain('€');
  });

  it('con codice: blocco credito col codice e importo', () => {
    const { html, text } = tplN26EmailPartenza({
      ...base,
      categoria: 'BROKER',
      codice: { code: 'BENVENUTO50', importoEuro: 50 },
    });
    expect(html).toContain('BENVENUTO50');
    expect(html).toContain('50');
    expect(html).toContain('credito di benvenuto');
    expect(text).toContain('BENVENUTO50');
  });

  it('la checklist documenti è presente', () => {
    const { html } = tplN26EmailPartenza({ ...base, categoria: 'AGENZIA' });
    expect(html).toContain('Visura camerale');
    expect(html).toContain('IBAN');
  });

  it('include il link di disiscrizione (email a freddo)', () => {
    const { html, text } = tplN26EmailPartenza({ ...base, categoria: 'BROKER' });
    expect(html).toContain('https://passaggioveloce.it/unsubscribe?token=uns123');
    expect(text).toContain('https://passaggioveloce.it/unsubscribe?token=uns123');
  });
});

describe('N46 visura in scadenza', () => {
  const base = {
    nomeAzienda: 'Rossi Auto',
    rimedioUrl: 'https://app.test/visura',
    visuraData: '2026-07-10',
  } as const;

  it('pluralizza correttamente "1 giorno" (non "1 giorni") vs "N giorni"', () => {
    const uno = tplN46VisuraInScadenza({ ...base, companyType: 'DEALER', giorniRimanenti: 1 });
    expect(uno.subject).toContain('1 giorno');
    expect(uno.subject).not.toContain('1 giorni');
    expect(uno.text).toContain('1 giorno');
    expect(uno.text).not.toContain('1 giorni');

    const cinque = tplN46VisuraInScadenza({ ...base, companyType: 'DEALER', giorniRimanenti: 5 });
    expect(cinque.subject).toContain('5 giorni');
  });

  it('dice quanti giorni restano e differenzia broker (solo wallet, futuro) da agenzia (operatività totale)', () => {
    const broker = tplN46VisuraInScadenza({ ...base, companyType: 'DEALER', giorniRimanenti: 3 });
    expect(broker.subject).toContain('3');
    expect(broker.text).toContain('prelie'); // broker: solo prelievi dal wallet
    expect(broker.text).not.toContain('pratiche'); // il broker NON perde l'operatività sulle pratiche
    expect(broker.text).toContain('potrai'); // tempo futuro: non ancora successo
    expect(broker.html).toContain('https://app.test/visura');

    const agenzia = tplN46VisuraInScadenza({ ...base, nomeAzienda: 'Agenzia X', companyType: 'AGENZIA', giorniRimanenti: 1 });
    expect(agenzia.text).toContain('pratiche'); // agenzia: operatività totale
  });

  it('escapa l\'HTML nel nome azienda (XSS stored)', () => {
    const c = tplN46VisuraInScadenza({
      ...base, nomeAzienda: '<script>alert(1)</script>', companyType: 'DEALER', giorniRimanenti: 2,
    });
    expect(c.html).not.toContain('<script>');
    expect(c.html).toContain('&lt;script&gt;');
  });

  it('non usa mai "sospeso"/"sospensione": è una limitazione operativa (clausola 8)', () => {
    const c = tplN46VisuraInScadenza({ ...base, companyType: 'AGENZIA', giorniRimanenti: 3 });
    const hay = `${c.subject}\n${c.text}\n${c.html}`.toLowerCase();
    expect(hay).not.toContain('sospes');
    expect(hay).toContain('clausola 8');
  });
});

describe('N47 visura scaduta', () => {
  const base = {
    nomeAzienda: 'Agenzia X',
    rimedioUrl: 'https://app.test/visura',
    visuraData: '2026-01-01',
    giorniTrascorsi: 4,
  } as const;

  it('dice che il blocco è già attivo (tempo presente), cita la clausola 8 e mai "sospeso"', () => {
    const c = tplN47VisuraScaduta({ ...base, companyType: 'AGENZIA' });
    expect(c.subject.toLowerCase()).toContain('scadut');
    expect(c.html).toContain('https://app.test/visura');
    expect(c.text).toContain('puoi'); // presente
    expect(c.text).not.toContain('potrai'); // NON futuro: è già successo
    expect(c.text).toContain('clausola 8');
    const hay = `${c.subject}\n${c.text}\n${c.html}`.toLowerCase();
    expect(hay).not.toContain('sospes');
    expect(hay).toContain('accesso'); // "l'accesso alla Piattaforma resta attivo"
  });

  it('usa giorniTrascorsi nel testo con la pluralizzazione corretta', () => {
    const uno = tplN47VisuraScaduta({ ...base, companyType: 'AGENZIA', giorniTrascorsi: 1 });
    expect(uno.text).toContain('1 giorno');
    expect(uno.text).not.toContain('1 giorni');

    const molti = tplN47VisuraScaduta({ ...base, companyType: 'AGENZIA', giorniTrascorsi: 12 });
    expect(molti.text).toContain('12 giorni');
  });

  it('differenzia broker (solo wallet) da agenzia (operatività totale), anche a blocco attivo', () => {
    const broker = tplN47VisuraScaduta({ ...base, companyType: 'DEALER' });
    expect(broker.text).toContain('prelie');
    expect(broker.text).not.toContain('pratiche');

    const agenzia = tplN47VisuraScaduta({ ...base, companyType: 'AGENZIA' });
    expect(agenzia.text).toContain('pratiche');
  });

  it('escapa l\'HTML nel nome azienda (XSS stored)', () => {
    const c = tplN47VisuraScaduta({
      ...base, nomeAzienda: '<img src=x onerror=alert(1)>', companyType: 'DEALER',
    });
    expect(c.html).not.toContain('<img src=x');
  });
});

describe('N48 broker pratica congelata', () => {
  it('dice al broker che non deve fare nulla e non lo chiama "bloccato" (adempimento altrui)', () => {
    const c = tplN48BrokerPraticaCongelata({
      nomeBroker: 'Mario Rossi',
      nomeAgenzia: 'Agenzia Corsico',
      praticaId: 'p1',
      praticaUrl: 'https://app.test/pratiche/p1',
      visuraData: '2026-01-01',
    });
    expect(c.html).toContain('https://app.test/pratiche/p1');
    expect(c.text.toLowerCase()).toContain('non devi fare nulla');
    expect(c.text).toContain('Agenzia Corsico');
    const hay = `${c.text}\n${c.html}`.toLowerCase();
    expect(hay).not.toContain('sei bloccato');
    expect(hay).not.toContain('account bloccato');
    expect(hay).not.toContain('sospes');
  });

  it('escapa l\'HTML nel nome broker e nel nome agenzia (XSS stored)', () => {
    const c = tplN48BrokerPraticaCongelata({
      nomeBroker: '<b>Mario</b>',
      nomeAgenzia: '<script>x</script>',
      praticaId: 'p1',
      praticaUrl: 'https://app.test/pratiche/p1',
      visuraData: '2026-01-01',
    });
    expect(c.html).not.toContain('<script>');
    expect(c.html).not.toContain('<b>Mario</b>');
  });
});

describe('N49 admin ateco non idoneo', () => {
  it('riporta azienda, codici ATECO, link admin e che la visura è stata accettata comunque', () => {
    const c = tplN49AdminAtecoNonIdoneo({
      nomeAzienda: 'Rossi Auto',
      companyType: 'DEALER',
      atecoCodes: '45.11.01, 45.19.01',
      adminUrl: 'https://app.test/admin/aziende/1',
    });
    expect(c.subject).toContain('Rossi Auto');
    expect(c.html).toContain('45.11.01');
    expect(c.html).toContain('https://app.test/admin/aziende/1');
    expect(c.text.toLowerCase()).toContain('accettata');
  });

  it('escapa l\'HTML nei codici ATECO e nel nome azienda (XSS stored)', () => {
    const c = tplN49AdminAtecoNonIdoneo({
      nomeAzienda: '<script>x</script>',
      companyType: 'AGENZIA',
      atecoCodes: '<img src=x onerror=alert(1)>',
      adminUrl: 'https://app.test/admin/aziende/1',
    });
    expect(c.html).not.toContain('<script>');
    expect(c.html).not.toContain('<img src=x');
  });
});

describe('N52 broker zona non coperta', () => {
  const base = {
    codicePratica: 'PV-2026-004',
    targa: 'AB123CD',
    nomeBroker: 'Rossi Auto',
    raggioMaxKm: 10,
  } as const;

  it('subject e body citano la pratica e il raggio massimo in km; passa dal layout istituzionale', () => {
    const c = tplN52BrokerZonaNonCoperta(base);
    expect(c.subject).toContain('PV-2026-004');
    expect(c.subject).toContain('10 km');
    expect(c.text).toContain('PV-2026-004');
    expect(c.text).toContain('10 km');
    expect(c.text.toLowerCase()).toContain('resta comunque attiva');
    expect(c.html).toContain('PV-2026-004');
    expect(c.html).toContain('10 km');
    // layout istituzionale condiviso
    expect(c.html).toContain('logo-email.png');
    expect(c.html).toContain('Passaggio Veloce SRL');
  });

  it('senza targa: nessuna parentesi vuota nel testo', () => {
    const c = tplN52BrokerZonaNonCoperta({ ...base, targa: null });
    expect(c.text).not.toContain('()');
    expect(c.html).not.toContain('()');
  });

  it('escapa l\'HTML in codicePratica, targa e nomeBroker (XSS stored)', () => {
    const c = tplN52BrokerZonaNonCoperta({
      codicePratica: '<script>alert(1)</script>',
      targa: '<img src=x onerror=alert(2)>',
      nomeBroker: '<b>Mario</b>',
      raggioMaxKm: 10,
    });
    expect(c.html).not.toContain('<script>');
    expect(c.html).not.toContain('<img src=x');
    expect(c.html).not.toContain('<b>Mario</b>');
    expect(c.html).toContain('&lt;script&gt;');
    expect(c.html).toContain('&lt;img');
    expect(c.html).toContain('&lt;b&gt;Mario&lt;/b&gt;');
  });
});
