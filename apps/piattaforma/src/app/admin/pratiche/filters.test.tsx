// @vitest-environment happy-dom
/**
 * Riproduce la soft-navigation reale dei tab (app/pratiche/tabs.tsx e
 * app/admin/pratiche/tabs.tsx sono <Link>): il componente filtri NON si
 * smonta quando `?stato=` cambia, riceve solo nuove props sullo stesso nodo.
 *
 * Una <select> uncontrolled con `defaultValue` applica quel valore SOLO al
 * mount (React, ReactDOMSelect.updateWrapper: su update, se `props.value` è
 * null e `multiple` non cambia, non fa nulla — `defaultValue` viene
 * ignorato). Senza `key={stato}` sulla select "stato", il DOM resterebbe
 * fermo sul valore precedente dopo un cambio di tab.
 *
 * Per questo il test ri-renderizza lo STESSO root con nuove props (non
 * smonta e rimonta un root nuovo, che sarebbe un altro scenario e non
 * riprodurrebbe il bug), poi legge il valore reale nel DOM.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AdminPraticheFilters } from './filters';
import { PraticheFilters } from '../../pratiche/filters';
import { opzioniStatoAdmin, opzioniStato } from '@/lib/pratiche/tabs';

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

/** Simula la soft-nav: stesso root, nuove props — mai smontare qui. */
function rerender(element: ReactElement): void {
  if (!root) throw new Error('chiama prima mount()');
  act(() => {
    root!.render(element);
  });
}

describe('AdminPraticheFilters — select "stato" su soft navigation dei tab', () => {
  it('si risincronizza col DOM quando un tab porta `stato` da vuoto a ATTESA_FIRMA', () => {
    const sedi = [{ value: '', label: 'Tutte le sedi' }];
    const stati = opzioniStatoAdmin();

    const el = mount(<AdminPraticheFilters stato={undefined} stati={stati} sedi={sedi} />);

    // Stesso root: com'è nella pagina reale quando si clicca il tab <Link>.
    rerender(<AdminPraticheFilters stato="ATTESA_FIRMA" stati={stati} sedi={sedi} />);

    const select = el.querySelector('select[name="stato"]') as HTMLSelectElement;
    expect(select.value).toBe('ATTESA_FIRMA');
  });
});

describe('PraticheFilters (broker/agenzia) — stesso pattern, stessa select', () => {
  it('si risincronizza col DOM quando un tab porta `stato` da vuoto a CONCLUSE', () => {
    const periodi = [{ value: '', label: 'Qualsiasi periodo' }];
    const stati = opzioniStato({ isAgenzia: false });

    const el = mount(
      <PraticheFilters stato={undefined} stati={stati} periodi={periodi} sedi={[]} />,
    );

    rerender(<PraticheFilters stato="CONCLUSE" stati={stati} periodi={periodi} sedi={[]} />);

    const select = el.querySelector('select[name="stato"]') as HTMLSelectElement;
    expect(select.value).toBe('CONCLUSE');
  });
});
