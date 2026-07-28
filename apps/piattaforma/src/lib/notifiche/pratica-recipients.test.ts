import { describe, it, expect } from 'vitest';
import { destinatariPratica, type Destinatario } from './pratica-recipients';

const operatore = (over: Partial<Destinatario> = {}): Destinatario => ({
  email: 'operatore@dealer.it',
  userId: 'u1',
  nome: 'Luca',
  isOwner: false,
  ...over,
});

const membro1: Destinatario = { email: 'sede1@dealer.it', userId: 'u2', nome: 'Anna', isOwner: false };
const membro2: Destinatario = { email: 'sede2@dealer.it', userId: 'u3', nome: 'Marco', isOwner: false };
/** Il titolare (ADMIN_AZIENDA) è anche membro della sede: in prod ha sempre una membership. */
const titolare: Destinatario = { email: 'admin@dealer.it', userId: 'u4', nome: 'Titolare', isOwner: true };

const vuoto = {
  preferito: null,
  membriSede: [] as Destinatario[],
  adminAzienda: null,
  emailAzienda: null,
  ragioneSociale: 'ROSSI SRL',
  ampiezza: 'chi-opera' as const,
};

/** Lato broker: la pratica è del punto vendita, ma il titolare non è un operatore. */
const sede = { ...vuoto, ampiezza: 'operatori-della-sede' as const };

describe('destinatariPratica — ampiezza `operatori-della-sede` (lato broker)', () => {
  it('operatore: ricevono lui E i colleghi operativi della sua sede', () => {
    expect(
      destinatariPratica({ ...sede, preferito: operatore(), membriSede: [membro1, membro2] }),
    ).toEqual([operatore(), membro1, membro2]);
  });

  it('operatore: il titolare NON riceve la posta dei suoi operatori', () => {
    expect(
      destinatariPratica({
        ...sede,
        preferito: operatore(),
        membriSede: [membro1, titolare, membro2],
        adminAzienda: titolare,
      }),
    ).toEqual([operatore(), membro1, membro2]);
  });

  it('admin di sede: è un operatore come gli altri, il titolare resta fuori', () => {
    const adminSede = operatore({ email: 'as@dealer.it', userId: 'u7', nome: 'Elena' });
    expect(
      destinatariPratica({ ...sede, preferito: adminSede, membriSede: [membro1, titolare] }),
    ).toEqual([adminSede, membro1]);
  });

  it('titolare: se lavora lui la pratica riceve lui E i suoi operatori', () => {
    expect(
      destinatariPratica({ ...sede, preferito: titolare, membriSede: [membro1, membro2] }),
    ).toEqual([titolare, membro1, membro2]);
  });

  it('titolare già membro della sede: compare una volta sola, come titolare', () => {
    expect(
      destinatariPratica({ ...sede, preferito: titolare, membriSede: [titolare, membro1] }),
    ).toEqual([titolare, membro1]);
  });

  it('il creatore già membro della sede compare una volta sola', () => {
    const stesso: Destinatario = { ...membro1, email: 'OPERATORE@Dealer.it ', userId: 'u1', nome: 'Luca' };
    expect(
      destinatariPratica({ ...sede, preferito: operatore(), membriSede: [stesso, membro1] }),
    ).toEqual([operatore(), membro1]);
  });

  it('creatore senza sede (pratica legacy): riceve solo lui', () => {
    expect(destinatariPratica({ ...sede, preferito: operatore() })).toEqual([operatore()]);
  });

  it('senza creatore (pratica storica): gli operatori della sede, non il titolare', () => {
    expect(
      destinatariPratica({ ...sede, membriSede: [membro1, titolare], adminAzienda: titolare }),
    ).toEqual([membro1]);
  });

  it('sede del solo titolare: nessuna notifica va persa, il titolare è la rete di sicurezza', () => {
    expect(
      destinatariPratica({ ...sede, membriSede: [titolare], adminAzienda: titolare }),
    ).toEqual([titolare]);
  });

  it('creatore non più raggiungibile e sede di soli operatori: ricevono loro', () => {
    expect(
      destinatariPratica({ ...sede, membriSede: [membro1, membro2], adminAzienda: titolare }),
    ).toEqual([membro1, membro2]);
  });
});

describe('destinatariPratica — ampiezza `chi-opera` (lato agenzia)', () => {
  it('operatore di sede: riceve solo lui, non i colleghi', () => {
    expect(
      destinatariPratica({ ...vuoto, preferito: operatore(), membriSede: [membro1, membro2] }),
    ).toEqual([operatore()]);
  });

  it('admin di sede: è admin della filiale, non dell\'azienda → riceve solo lui', () => {
    const adminSede = operatore({ email: 'as@dealer.it', userId: 'u7', nome: 'Elena' });
    expect(
      destinatariPratica({ ...vuoto, preferito: adminSede, membriSede: [membro1] }),
    ).toEqual([adminSede]);
  });

  it('titolare: ricevono lui e tutti i membri della sede da cui ha operato', () => {
    expect(
      destinatariPratica({ ...vuoto, preferito: titolare, membriSede: [membro1, membro2] }),
    ).toEqual([titolare, membro1, membro2]);
  });

  it('titolare già membro della sede: compare una volta sola', () => {
    const owner: Destinatario = { ...titolare, email: 'Admin@Dealer.it ' };
    expect(
      destinatariPratica({ ...vuoto, preferito: owner, membriSede: [titolare, membro1] }),
    ).toEqual([owner, membro1]);
  });

  it('titolare senza sede (pratica legacy): riceve solo lui', () => {
    expect(destinatariPratica({ ...vuoto, preferito: titolare })).toEqual([titolare]);
  });

  it('N6 (nessun preferito): la sede intera, titolare incluso — deve poterla accettare', () => {
    expect(
      destinatariPratica({ ...vuoto, membriSede: [membro1, titolare] }),
    ).toEqual([membro1, titolare]);
  });
});

describe('destinatariPratica — la catena si ferma al primo livello non vuoto', () => {
  it('il preferito vince su membri e admin', () => {
    expect(
      destinatariPratica({
        ...vuoto,
        preferito: operatore(),
        membriSede: [membro1],
        adminAzienda: titolare,
      }),
    ).toEqual([operatore()]);
  });

  it('senza preferito: tutti i membri della sede', () => {
    expect(
      destinatariPratica({ ...vuoto, membriSede: [membro1, membro2], adminAzienda: titolare }),
    ).toEqual([membro1, membro2]);
  });

  it('sede senza membri: l\'admin azienda', () => {
    expect(destinatariPratica({ ...vuoto, adminAzienda: titolare })).toEqual([titolare]);
  });

  it('nessun utente: l\'email azienda, con la ragione sociale come nome', () => {
    expect(destinatariPratica({ ...vuoto, emailAzienda: 'info@rossi.it' })).toEqual([
      { email: 'info@rossi.it', userId: null, nome: 'ROSSI SRL', isOwner: true },
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
    expect(destinatariPratica({ ...vuoto, adminAzienda: titolare })).toEqual([titolare]);
  });
});

describe('destinatariPratica — igiene degli indirizzi', () => {
  it('deduplica i membri per email, ignorando maiuscole e spazi', () => {
    const dup: Destinatario = { ...membro1, email: '  SEDE1@Dealer.it ', userId: 'u9', nome: 'Doppione' };
    expect(destinatariPratica({ ...vuoto, membriSede: [membro1, dup, membro2] })).toEqual([
      membro1,
      membro2,
    ]);
  });

  it('scarta i candidati con email vuota invece di inviare al nulla', () => {
    const rotto = operatore({ email: '   ', userId: 'u8', nome: 'Rotto' });
    expect(destinatariPratica({ ...vuoto, preferito: rotto, adminAzienda: titolare })).toEqual([
      titolare,
    ]);
  });

  it('l\'email azienda viene ripulita dagli spazi', () => {
    expect(destinatariPratica({ ...vuoto, emailAzienda: '  info@rossi.it  ' })).toEqual([
      { email: 'info@rossi.it', userId: null, nome: 'ROSSI SRL', isOwner: true },
    ]);
  });
});
