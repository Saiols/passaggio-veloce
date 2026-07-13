// @vitest-environment happy-dom
/**
 * Riproduce il bug reale segnalato dall'utente su attesta-firma-button.tsx:
 * nel popup di attestazione firma l'utente scrive UNA lettera nella
 * <textarea> della motivazione e il focus salta sul bottone "✕" di chiusura.
 *
 * Causa: l'effect di Modal che gestisce focus-trap/Esc/scroll-lock dipendeva
 * da `[open, onClose]`. Il consumer reale passa `onClose` come arrow inline
 * (`onClose={() => { if (!pending) setOpen(false); }}`), quindi ogni render
 * crea una nuova identità di funzione. La textarea è controllata (`value` +
 * `onChange` che aggiorna lo state): ogni tasto è un render. Ogni render →
 * nuova identità di `onClose` → l'effect si ri-esegue → rifà
 * `dialogRef.current.querySelector(...).focus()`, che è il bottone ✕
 * (primo elemento focusabile nel DOM del dialog, riga ~99 di modal.tsx).
 *
 * Il fix rende l'effect indipendente dall'identità di `onClose` (deps
 * `[open]` invece di `[open, onClose]`); qui si riproduce lo scenario
 * ri-renderizzando lo STESSO root con una nuova arrow function ad ogni
 * chiamata, esattamente come farebbe un `setState` ad ogni tasto premuto.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Modal } from './modal';

// Richiesto da React per usare `act()` fuori da un test runner che lo imposta
// da sé (qui siamo su happy-dom puro, senza @testing-library).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

function mount(element: ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(element);
  });
  return container;
}

/** Simula il re-render da setState: stesso root, non smontare. */
function rerender(element: ReactElement): void {
  if (!root) throw new Error('chiama prima mount()');
  act(() => {
    root!.render(element);
  });
}

/**
 * L'effect di Modal usa `queueMicrotask` per il focus iniziale: `act()`
 * sincrono flush-a gli effect ma non la microtask queue. Bisogna lasciarla
 * svuotare esplicitamente dentro un `act(async () => ...)`.
 */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function renderModal(onClose: () => void): ReactElement {
  return (
    <Modal open={true} onClose={onClose} title="Attestare la firma?">
      <textarea aria-label="motivazione" />
    </Modal>
  );
}

describe('Modal — focus non deve saltare sulla ✕ mentre si digita in un campo controllato', () => {
  it('mantiene il focus sulla textarea quando onClose (arrow inline) cambia identità ad ogni render', async () => {
    // Modal fa il portal in document.body, non nel container montato:
    // il dialog va cercato lì, non dentro `el`.
    mount(renderModal(() => {}));
    await flushMicrotasks();

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    // Simula: l'utente scrive una lettera -> setState -> re-render. Il
    // consumer reale passa `onClose={() => { ... setOpen(false); }}`, quindi
    // ad ogni render `onClose` è una funzione con identità nuova.
    rerender(renderModal(() => {}));
    await flushMicrotasks();

    expect(document.activeElement).toBe(textarea);
  });

  it('non-regressione: all’apertura il focus va comunque dentro il dialog', async () => {
    mount(renderModal(() => {}));
    await flushMicrotasks();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });
});
