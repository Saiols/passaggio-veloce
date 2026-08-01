// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ContactModal } from './client';

// `client.tsx` importa le server action del pannello contatto (creazione,
// update, invio email...): quel modulo trascina `@/auth` e con esso l'intera
// catena next-auth. `ContactModal` non le esegue in questo test (il
// salvataggio è bloccato dalla validazione prima di chiamarle): si mocka il
// modulo per tenere il test isolato dal server, non per aggirare un problema
// del componente sotto test.
vi.mock('./actions', () => ({
  createCrmContactAction: vi.fn(),
  updateCrmContactAction: vi.fn(),
  deleteCrmContactAction: vi.fn(),
  bulkImportCrmContactsAction: vi.fn(),
  updateCrmContactStatusAction: vi.fn(),
  updateCrmContactGiudizioAction: vi.fn(),
  updateCrmContactRichiamoAction: vi.fn(),
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

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(host!.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!btn) throw new Error(`Bottone non trovato: "${text}"`);
  return btn;
}

function selectByLabel(label: string): HTMLSelectElement {
  const wrapper = Array.from(host!.querySelectorAll('label')).find((l) =>
    l.querySelector('span')?.textContent?.startsWith(label),
  );
  const select = wrapper?.querySelector('select');
  if (!select) throw new Error(`Select non trovata per label "${label}"`);
  return select;
}

describe('ContactModal — assi Fatti e Giudizio separati (modello a tre assi)', () => {
  // Dal 2026-08 il modale separa i FATTI (funnel oggettivo `status`) dal
  // GIUDIZIO soggettivo (`giudizio`) e dal RICHIAMO (`nextContactAt`). La
  // tendina "Stato (fatti)" non deve più offrire i valori soggettivi/di
  // richiamo (S2 Non interessato, S3 Interessato, S11 Richiamare): quelli
  // vivono ora sull'asse Giudizio e sul richiamo, non su `status`.
  it("la tendina Stato (fatti) non offre più S2/S3/S11, e c'è un asse Giudizio", () => {
    render(
      <ContactModal
        contact={null}
        salesUsers={[]}
        canDelete={false}
        currentUserRole="ADMIN_PIATTAFORMA"
        currentUserId="u1"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    act(() => buttonByText('Stato & Chiamate').click());

    const statoSelect = selectByLabel('Stato (fatti)');
    const valoriStato = Array.from(statoSelect.options).map((o) => o.value);
    expect(valoriStato).toContain('S0');
    expect(valoriStato).toContain('S4');
    expect(valoriStato).toContain('S7');
    expect(valoriStato).not.toContain('S2');
    expect(valoriStato).not.toContain('S3');
    expect(valoriStato).not.toContain('S11');

    const giudizioSelect = selectByLabel('Giudizio (soggettivo)');
    const valoriGiudizio = Array.from(giudizioSelect.options).map((o) => o.value);
    expect(valoriGiudizio).toEqual(['', 'INTERESSATO', 'NON_INTERESSATO']);
  });
});
