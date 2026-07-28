// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RigaArricchimento } from './client';

// `client.tsx` importa le server action del pannello contatto (creazione,
// update, invio email...): quel modulo trascina `@/auth` e con esso l'intera
// catena next-auth. `RigaArricchimento` non le usa: si mocka il modulo per
// tenere il test isolato dal server, non per aggirare un problema del
// componente sotto test.
vi.mock('./actions', () => ({
  createCrmContactAction: vi.fn(),
  updateCrmContactAction: vi.fn(),
  deleteCrmContactAction: vi.fn(),
  bulkImportCrmContactsAction: vi.fn(),
  updateCrmContactStatusAction: vi.fn(),
  sendEmailPartenzaAction: vi.fn(),
}));

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

describe('RigaArricchimento', () => {
  // Guardia contro il bug "JSX mangia gli spazi": il separatore ' — ' e il
  // punto ' · ' prima della data devono comparire nel testo RENDERIZZATO,
  // non solo nel sorgente JSX. Si asserisce sull'intera stringa, non su
  // sottostringhe isolate.
  it('rende etichette (non nomi grezzi dei campi) e data, con i separatori corretti', () => {
    render(<RigaArricchimento da="email,piva,regione" at="2026-07-20T10:00:00.000Z" />);
    expect(host!.textContent).toBe(
      "Dati completati dall'iscrizione — Email, P.IVA, Regione · 20/07/2026",
    );
  });

  it('senza data (record storico pre-audit): niente separatore finale appeso a vuoto', () => {
    render(<RigaArricchimento da="wa" at={null} />);
    expect(host!.textContent).toBe("Dati completati dall'iscrizione — WhatsApp");
  });

  // `arricchitoDa` arriva già in ordine canonico: lo scrive `unisciArricchitoDa`
  // (lib/crm/match/arricchimento.ts), che ordina secondo `CAMPI_ARRICCHIBILI`
  // prima di salvare. Il componente si limita a tradurre ogni voce in
  // etichetta e a unirle con virgola, nell'ordine in cui le riceve.
  it('più campi si uniscono con virgola, nell\'ordine ricevuto', () => {
    render(<RigaArricchimento da="email,cap,regione" at={null} />);
    expect(host!.textContent).toBe(
      "Dati completati dall'iscrizione — Email, CAP, Regione",
    );
  });
});
