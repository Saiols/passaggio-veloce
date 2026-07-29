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

describe('ContactModal — Salva con stato S11 senza toccare il giorno del richiamo', () => {
  // Regressione: `handleSave` sceglieva il tab su cui atterrare leggendo
  // `field('nextContactAt').invalid`, che dipende da `touched`/`revealed` —
  // stato React aggiornato da `reveal()` in modo asincrono. Nella closure del
  // click che ha appena chiamato `reveal()`, `field` è ancora quello del
  // render precedente: al primo clic su Salva, con lo stato portato a S11
  // SENZA mai passare dal campo data (flusso naturale: cambio la tendina
  // Stato, premo Salva), l'utente veniva spedito sul tab "Anagrafica" — dove
  // nome e telefono sono validi e non compare nessun rosso — invece che su
  // "Stato & Chiamate", dove sta il vero errore. Il pulsante Salva sembra non
  // fare niente. Il fix legge `errors.nextContactAt` (ricalcolato ad ogni
  // render da zodFieldErrors, indipendente da touched/revealed) al posto di
  // `field(...).invalid`.
  it('resta sul tab Stato & Chiamate con l\'errore visibile sul giorno', () => {
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

    // Vai sul tab Stato & Chiamate e porta lo stato a S11, senza toccare il
    // campo data (niente blur, niente onChange su nextContactAt).
    act(() => buttonByText('Stato & Chiamate').click());
    const statoSelect = selectByLabel('Stato CRM');
    act(() => {
      statoSelect.value = 'S11';
      statoSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Salva, senza mai aver toccato il campo del giorno.
    act(() => buttonByText('Salva').click());

    const tabStato = buttonByText('Stato & Chiamate');
    const tabAnagrafica = buttonByText('Anagrafica');
    expect(tabStato.getAttribute('aria-selected')).toBe('true');
    expect(tabAnagrafica.getAttribute('aria-selected')).toBe('false');
    expect(host!.textContent).toContain(
      'Con lo stato Richiamare serve il giorno del richiamo',
    );
  });
});
