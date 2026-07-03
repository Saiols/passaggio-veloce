import { describe, it, expect } from 'vitest';
import { buildClienteRecipients, veicoloDescrizione } from './cliente-recipients';

const acquirente = {
  acquirenteEmail: 'buyer@x.it',
  acquirenteNome: 'Mario',
  acquirenteCognome: 'Rossi',
  acquirenteIsPersonaGiuridica: false,
  acquirenteRagioneSociale: null,
  coAcquirenti: [],
};

describe('veicoloDescrizione', () => {
  it('singolo veicolo: targa', () => {
    expect(veicoloDescrizione([{ targa: 'AB123CD' }])).toBe('AB123CD');
  });
  it('piu veicoli: targa + contatore', () => {
    expect(veicoloDescrizione([{ targa: 'AB123CD' }, { targa: 'EF456GH' }])).toBe('AB123CD +1');
  });
  it('nessuna targa: null', () => {
    expect(veicoloDescrizione([{ targa: null }])).toBeNull();
    expect(veicoloDescrizione([])).toBeNull();
  });
});

describe('buildClienteRecipients', () => {
  it('acquirente + venditori, ruoli corretti', () => {
    const r = buildClienteRecipients({
      ...acquirente,
      venditori: [
        { email: 'seller1@x.it', nome: 'Anna', cognome: 'Bianchi', isPersonaGiuridica: false, ragioneSociale: null },
        { email: 'seller2@x.it', nome: 'Luca', cognome: 'Verdi', isPersonaGiuridica: false, ragioneSociale: null },
      ],
    });
    expect(r).toEqual([
      { email: 'buyer@x.it', ruolo: 'ACQUIRENTE', nomeDestinatario: 'Mario Rossi' },
      { email: 'seller1@x.it', ruolo: 'VENDITORE', nomeDestinatario: 'Anna Bianchi' },
      { email: 'seller2@x.it', ruolo: 'VENDITORE', nomeDestinatario: 'Luca Verdi' },
    ]);
  });

  it('dedup per email case-insensitive, vince il primo (acquirente)', () => {
    const r = buildClienteRecipients({
      ...acquirente,
      venditori: [
        { email: 'BUYER@x.it', nome: 'Dup', cognome: 'Persona', isPersonaGiuridica: false, ragioneSociale: null },
        { email: 'seller@x.it', nome: 'Anna', cognome: 'Bianchi', isPersonaGiuridica: false, ragioneSociale: null },
      ],
    });
    expect(r.map((x) => x.email)).toEqual(['buyer@x.it', 'seller@x.it']);
    expect(r[0]!.ruolo).toBe('ACQUIRENTE');
  });

  it('filtra email mancanti/vuote', () => {
    const r = buildClienteRecipients({
      ...acquirente,
      acquirenteEmail: null,
      venditori: [
        { email: '  ', nome: 'A', cognome: 'B', isPersonaGiuridica: false, ragioneSociale: null },
        { email: 'ok@x.it', nome: 'C', cognome: 'D', isPersonaGiuridica: false, ragioneSociale: null },
      ],
    });
    expect(r.map((x) => x.email)).toEqual(['ok@x.it']);
  });

  it('persona giuridica: usa ragione sociale', () => {
    const r = buildClienteRecipients({
      acquirenteEmail: 'pg@x.it', acquirenteNome: null, acquirenteCognome: null,
      acquirenteIsPersonaGiuridica: true, acquirenteRagioneSociale: 'ACME Srl',
      venditori: [],
      coAcquirenti: [],
    });
    expect(r[0]!.nomeDestinatario).toBe('ACME Srl');
  });

  it('nome assente: fallback Cliente', () => {
    const r = buildClienteRecipients({
      acquirenteEmail: 'x@x.it', acquirenteNome: null, acquirenteCognome: null,
      acquirenteIsPersonaGiuridica: false, acquirenteRagioneSociale: null,
      venditori: [],
      coAcquirenti: [],
    });
    expect(r[0]!.nomeDestinatario).toBe('Cliente');
  });

  it('co-intestatari acquirente: inclusi con ruolo ACQUIRENTE, prima dei venditori', () => {
    const r = buildClienteRecipients({
      ...acquirente,
      venditori: [
        { email: 'seller1@x.it', nome: 'Anna', cognome: 'Bianchi', isPersonaGiuridica: false, ragioneSociale: null },
      ],
      coAcquirenti: [
        { email: 'co1@x.it', nome: 'Paolo', cognome: 'Neri', isPersonaGiuridica: false, ragioneSociale: null },
        { email: 'co2@x.it', nome: 'Giulia', cognome: 'Gialli', isPersonaGiuridica: false, ragioneSociale: null },
      ],
    });
    expect(r).toEqual([
      { email: 'buyer@x.it', ruolo: 'ACQUIRENTE', nomeDestinatario: 'Mario Rossi' },
      { email: 'co1@x.it', ruolo: 'ACQUIRENTE', nomeDestinatario: 'Paolo Neri' },
      { email: 'co2@x.it', ruolo: 'ACQUIRENTE', nomeDestinatario: 'Giulia Gialli' },
      { email: 'seller1@x.it', ruolo: 'VENDITORE', nomeDestinatario: 'Anna Bianchi' },
    ]);
  });

  it('co-intestatario con email duplicata dell\'acquirente principale: deduplicato (case-insensitive)', () => {
    const r = buildClienteRecipients({
      ...acquirente,
      venditori: [
        { email: 'seller1@x.it', nome: 'Anna', cognome: 'Bianchi', isPersonaGiuridica: false, ragioneSociale: null },
      ],
      coAcquirenti: [
        { email: 'BUYER@x.it', nome: 'Dup', cognome: 'Acquirente', isPersonaGiuridica: false, ragioneSociale: null },
        { email: 'co1@x.it', nome: 'Paolo', cognome: 'Neri', isPersonaGiuridica: false, ragioneSociale: null },
      ],
    });
    expect(r.map((x) => x.email)).toEqual(['buyer@x.it', 'co1@x.it', 'seller1@x.it']);
    expect(r).toHaveLength(3);
  });

  it('co-intestatario con email duplicata di un venditore: deduplicato (vince il primo, il co-intestatario)', () => {
    const r = buildClienteRecipients({
      ...acquirente,
      venditori: [
        { email: 'seller1@x.it', nome: 'Anna', cognome: 'Bianchi', isPersonaGiuridica: false, ragioneSociale: null },
      ],
      coAcquirenti: [
        { email: 'seller1@x.it', nome: 'Dup', cognome: 'DiVenditore', isPersonaGiuridica: false, ragioneSociale: null },
      ],
    });
    // Il co-intestatario e' processato prima del venditore (ordine acquirenti->venditori):
    // vince il primo push, quindi una sola voce con ruolo ACQUIRENTE.
    expect(r).toEqual([
      { email: 'buyer@x.it', ruolo: 'ACQUIRENTE', nomeDestinatario: 'Mario Rossi' },
      { email: 'seller1@x.it', ruolo: 'ACQUIRENTE', nomeDestinatario: 'Dup DiVenditore' },
    ]);
  });
});
