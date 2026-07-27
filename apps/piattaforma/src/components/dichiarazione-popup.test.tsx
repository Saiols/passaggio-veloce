// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DichiarazionePopup } from './dichiarazione-popup';
import type { IdAttestazione } from '@/lib/legal/attestazioni';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

let root: Root | null = null;
let host: HTMLElement | null = null;

function render(node: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

function bottoneInvia(): HTMLButtonElement {
  const b = [...document.querySelectorAll('button')].find((x) =>
    x.textContent?.includes('Conferma e invia'),
  );
  if (!b) throw new Error('Bottone "Conferma e invia" non trovato');
  return b as HTMLButtonElement;
}

function checkboxes(): HTMLInputElement[] {
  return [...document.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function renderPopup(accettate: Partial<Record<IdAttestazione, boolean>>, onToggle = vi.fn()) {
  render(
    <DichiarazionePopup
      open
      accettate={accettate}
      pending={false}
      onToggle={onToggle}
      onConfirm={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return onToggle;
}

describe('DichiarazionePopup', () => {
  it('rende una checkbox per ogni attestazione corrente', () => {
    renderPopup({});
    expect(checkboxes()).toHaveLength(2);
    expect(document.body.textContent).toContain('assenza di fermi amministrativi');
    expect(document.body.textContent).toContain("Dichiaro di aver informato il venditore");
  });

  it('con nessuna spunta il bottone di invio e disabilitato', () => {
    renderPopup({});
    expect(bottoneInvia().disabled).toBe(true);
  });

  // Il punto della release: l'attestazione privacy non e' piu' assorbita da
  // un'altra spunta. Una sola non basta.
  it('con una sola spunta il bottone di invio resta disabilitato', () => {
    renderPopup({ RESPONSABILITA: true });
    expect(bottoneInvia().disabled).toBe(true);
  });

  it('con una sola spunta (solo terzi) il bottone di invio resta disabilitato', () => {
    renderPopup({ TERZI: true });
    expect(bottoneInvia().disabled).toBe(true);
  });

  it('con entrambe le spunte il bottone di invio si abilita', () => {
    renderPopup({ RESPONSABILITA: true, TERZI: true });
    expect(bottoneInvia().disabled).toBe(false);
  });

  it('spuntare una casella notifica il suo id al chiamante', () => {
    const onToggle = renderPopup({});
    act(() => {
      checkboxes()[1].click();
    });
    expect(onToggle).toHaveBeenCalledWith('TERZI', true);
  });

  it("mostra il rimando all'informativa per venditori e acquirenti", () => {
    renderPopup({});
    const link = [...document.querySelectorAll('a')].find(
      (a) => a.getAttribute('href') === '/privacy/clienti',
    );
    expect(link).toBeDefined();
  });

  it('chiuso non rende nulla', () => {
    render(
      <DichiarazionePopup
        open={false}
        accettate={{ RESPONSABILITA: true, TERZI: true }}
        pending={false}
        onToggle={vi.fn()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(checkboxes()).toHaveLength(0);
  });
});
