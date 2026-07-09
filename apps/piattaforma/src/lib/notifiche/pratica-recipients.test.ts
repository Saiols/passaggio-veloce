import { describe, it, expect } from 'vitest';
import { destinatariPratica, type Destinatario, type Preferito } from './pratica-recipients';

const creatore: Preferito = { email: 'operatore@dealer.it', userId: 'u1', nome: 'Luca', isOwner: false };
const membro1: Destinatario = { email: 'sede1@dealer.it', userId: 'u2', nome: 'Anna' };
const membro2: Destinatario = { email: 'sede2@dealer.it', userId: 'u3', nome: 'Marco' };
const admin: Destinatario = { email: 'admin@dealer.it', userId: 'u4', nome: 'Titolare' };

/** Il preferito restituito è un Destinatario puro: `isOwner` non esce dal risolutore. */
const soloDestinatario = ({ email, userId, nome }: Preferito): Destinatario => ({ email, userId, nome });

const vuoto = {
  preferito: null,
  membriSede: [],
  adminAzienda: null,
  emailAzienda: null,
  ragioneSociale: 'ROSSI SRL',
};

describe('destinatariPratica — chi opera decide l\'ampiezza', () => {
  it('operatore di sede: riceve solo lui, non i colleghi', () => {
    expect(
      destinatariPratica({ ...vuoto, preferito: creatore, membriSede: [membro1, membro2] }),
    ).toEqual([soloDestinatario(creatore)]);
  });

  it('admin di sede: è admin della filiale, non dell\'azienda → riceve solo lui', () => {
    const adminSede: Preferito = { email: 'as@dealer.it', userId: 'u7', nome: 'Elena', isOwner: false };
    expect(
      destinatariPratica({ ...vuoto, preferito: adminSede, membriSede: [membro1] }),
    ).toEqual([soloDestinatario(adminSede)]);
  });

  it('super admin: ricevono lui e tutti i membri della sede da cui ha operato', () => {
    const owner: Preferito = { email: 'titolare@dealer.it', userId: 'u4', nome: 'Titolare', isOwner: true };
    expect(
      destinatariPratica({ ...vuoto, preferito: owner, membriSede: [membro1, membro2] }),
    ).toEqual([soloDestinatario(owner), membro1, membro2]);
  });

  it('super admin già membro della sede: compare una volta sola', () => {
    const owner: Preferito = { email: 'Titolare@Dealer.it ', userId: 'u4', nome: 'Titolare', isOwner: true };
    const stessoOwner: Destinatario = { email: 'titolare@dealer.it', userId: 'u4', nome: 'Titolare' };
    expect(
      destinatariPratica({ ...vuoto, preferito: owner, membriSede: [stessoOwner, membro1] }),
    ).toEqual([{ email: 'Titolare@Dealer.it ', userId: 'u4', nome: 'Titolare' }, membro1]);
  });

  it('super admin senza sede (pratica legacy): riceve solo lui', () => {
    const owner: Preferito = { email: 'titolare@dealer.it', userId: 'u4', nome: 'Titolare', isOwner: true };
    expect(destinatariPratica({ ...vuoto, preferito: owner })).toEqual([soloDestinatario(owner)]);
  });
});

describe('destinatariPratica — la catena si ferma al primo livello non vuoto', () => {
  it('il preferito vince su membri e admin', () => {
    expect(
      destinatariPratica({ ...vuoto, preferito: creatore, membriSede: [membro1], adminAzienda: admin }),
    ).toEqual([soloDestinatario(creatore)]);
  });

  it('senza preferito: tutti i membri della sede', () => {
    expect(
      destinatariPratica({ ...vuoto, membriSede: [membro1, membro2], adminAzienda: admin }),
    ).toEqual([membro1, membro2]);
  });

  it('sede senza membri: l\'admin azienda', () => {
    expect(destinatariPratica({ ...vuoto, adminAzienda: admin })).toEqual([admin]);
  });

  it('nessun utente: l\'email azienda, con la ragione sociale come nome', () => {
    expect(destinatariPratica({ ...vuoto, emailAzienda: 'info@rossi.it' })).toEqual([
      { email: 'info@rossi.it', userId: null, nome: 'ROSSI SRL' },
    ]);
  });

  it('nulla di nulla: lista vuota, il chiamante non invia', () => {
    expect(destinatariPratica(vuoto)).toEqual([]);
  });
});

describe('destinatariPratica — pratica storica (colonne null)', () => {
  // Le pratiche create prima di questa feature non hanno creatoDaUserId né sede:
  // devono continuare a notificare l'admin azienda, esattamente come oggi.
  it('senza preferito e senza sede ricade sull\'admin azienda', () => {
    expect(destinatariPratica({ ...vuoto, adminAzienda: admin })).toEqual([admin]);
  });
});

describe('destinatariPratica — igiene degli indirizzi', () => {
  it('deduplica i membri per email, ignorando maiuscole e spazi', () => {
    const dup: Destinatario = { email: '  SEDE1@Dealer.it ', userId: 'u9', nome: 'Doppione' };
    expect(destinatariPratica({ ...vuoto, membriSede: [membro1, dup, membro2] })).toEqual([
      membro1,
      membro2,
    ]);
  });

  it('scarta i candidati con email vuota invece di inviare al nulla', () => {
    const rotto: Preferito = { email: '   ', userId: 'u8', nome: 'Rotto', isOwner: false };
    expect(destinatariPratica({ ...vuoto, preferito: rotto, adminAzienda: admin })).toEqual([admin]);
  });

  it('l\'email azienda viene ripulita dagli spazi', () => {
    expect(destinatariPratica({ ...vuoto, emailAzienda: '  info@rossi.it  ' })).toEqual([
      { email: 'info@rossi.it', userId: null, nome: 'ROSSI SRL' },
    ]);
  });
});
