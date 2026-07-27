// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AttestazioneCard } from './attestazione-card';

let root: Root | null = null;
let host: HTMLElement | null = null;

function render(node: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

type Dichiarazione = Parameters<typeof AttestazioneCard>[0]['dichiarazione'];

/** Fixture minima; ogni test sovrascrive solo i campi che le interessano. */
function dichiarazione(overrides: Partial<Dichiarazione>): Dichiarazione {
  return {
    createdAt: new Date('2026-07-15T12:00:00Z'),
    ip: '82.51.12.0',
    userAgent: null,
    popupVersion: 'v4.0',
    testoAttestazioni: null,
    clausolaTerzi: null,
    user: { nome: 'Mario', cognome: 'Rossi', email: 'mario.rossi@example.it' },
    ...overrides,
  };
}

describe('AttestazioneCard', () => {
  it('record v4.0 con testoAttestazioni valorizzato: rende i testi persistiti, non quelli del registro', () => {
    render(
      <AttestazioneCard
        dichiarazione={dichiarazione({
          popupVersion: 'v4.0',
          clausolaTerzi: 23,
          testoAttestazioni: [
            { id: 'RESPONSABILITA', testo: 'Testo persistito di responsabilita.' },
            { id: 'TERZI', testo: 'Testo persistito sui terzi.' },
          ],
        })}
      />,
    );
    expect(document.body.textContent).toContain('Testo persistito di responsabilita.');
    expect(document.body.textContent).toContain('Testo persistito sui terzi.');
  });

  // Il percorso che serve davvero ai record gia' in produzione: nessun testo
  // persistito, si ricostruisce dal registro tramite la versione.
  it('record storico v3.1 con testoAttestazioni null: ricade sul testo del registro', () => {
    render(
      <AttestazioneCard
        dichiarazione={dichiarazione({
          popupVersion: 'v3.1',
          clausolaTerzi: null,
          testoAttestazioni: null,
        })}
      />,
    );
    expect(document.body.textContent).toContain(
      'Confermo di aver verificato quanto sopra, di aver informato venditore e acquirente ' +
        'sul trattamento dei loro dati (clausola 23 dei Termini) e mi assumo piena responsabilità',
    );
  });

  // Guardia di regressione per il Finding 1: v3.0 citava la clausola 17, non
  // la 23. Un fallback fisso a 23 nell'intestazione contraddirebbe il testo
  // reso subito sotto. Scritto PRIMA del fix e verificato rosso.
  it('record storico v3.0: intestazione senza numero indovinato, testo con la clausola storica (17)', () => {
    render(
      <AttestazioneCard
        dichiarazione={dichiarazione({
          popupVersion: 'v3.0',
          clausolaTerzi: null,
          testoAttestazioni: null,
        })}
      />,
    );
    expect(document.body.textContent).not.toContain('clausola 23');
    expect(document.body.textContent).toContain('clausola 17');
  });

  it('versione ignota al registro e testoAttestazioni null: messaggio esplicito, non un blocco vuoto', () => {
    render(
      <AttestazioneCard
        dichiarazione={dichiarazione({
          popupVersion: 'v9.9',
          clausolaTerzi: null,
          testoAttestazioni: null,
        })}
      />,
    );
    expect(document.body.textContent).toContain('Testo non ricostruibile');
    expect(document.body.textContent).toContain('v9.9');
  });

  it('testoAttestazioni di forma inattesa (senza campo testo): non esplode, ricade sul registro', () => {
    render(
      <AttestazioneCard
        dichiarazione={dichiarazione({
          popupVersion: 'v4.0',
          clausolaTerzi: 23,
          testoAttestazioni: [{ id: 'X' }],
        })}
      />,
    );
    expect(document.body.textContent).toContain('assenza di fermi amministrativi');
    expect(document.body.textContent).toContain("Dichiaro di aver informato il venditore");
  });
});
