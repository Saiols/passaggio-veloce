// @vitest-environment happy-dom
/**
 * La modale di lancio dell'affiliazione ha due memorie diverse, ed è facilissimo
 * confonderle:
 *  - chiusura SEMPLICE  → basta il cookie di sessione (la GET l'ha già settato):
 *    la modale torna al prossimo login. NESSUNA scrittura su DB.
 *  - chiusura con "non mostrare più" → POST, che scrive la presa visione
 *    definitiva su User.affiliazioneSpotDismissedAt.
 *
 * Se la chiusura semplice scrivesse anche lei, la checkbox sarebbe decorativa e
 * nessuno rivedrebbe mai la modale: è il bug che questi test presidiano.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { AffiliazioneSpot } from './affiliazione-spot';
import { AFF_SPOT_COOKIE } from '@/lib/affiliazione/spot-cookie';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAYLOAD = {
  show: true,
  link: 'https://app.test/r/abc12345',
  sedeNomeFallback: null,
  sempliceCent: 1000,
  minivolturaCent: 500,
  minPayoutCent: 50_000,
  messaggioWhatsapp: 'Ciao! ... https://app.test/r/abc12345',
};

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

function pulisciCookie(): void {
  document.cookie = `${AFF_SPOT_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(<AffiliazioneSpot />);
  });
}

/** Cerca un bottone/link per testo esatto nel dialog montato in <body>. */
function perTesto(testo: string): HTMLElement {
  const nodi = Array.from(document.querySelectorAll('button, a'));
  const trovato = nodi.find((n) => n.textContent?.trim() === testo);
  if (!trovato) throw new Error(`Elemento "${testo}" non trovato nel DOM`);
  return trovato as HTMLElement;
}

beforeEach(() => {
  pulisciCookie();
  fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(PAYLOAD) } as Response),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  pulisciCookie();
  vi.restoreAllMocks();
});

describe('AffiliazioneSpot', () => {
  it('mostra la modale col link quando il server dice di mostrarla', async () => {
    await render();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Invita un collega');
    expect(document.body.textContent).toContain('https://app.test/r/abc12345');
    // Importi dal payload, non hardcodati nel componente.
    expect(document.body.textContent).toContain('10,00');
    expect(document.body.textContent).toContain('5,00');
  });

  it('chiusa senza checkbox NON scrive la presa visione (torna al prossimo login)', async () => {
    await render();

    await act(async () => {
      perTesto('Chiudi').click();
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const post = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === 'POST',
    );
    expect(post).toHaveLength(0);
  });

  it('chiusa con "non mostrare più" scrive la presa visione definitiva', async () => {
    await render();

    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      checkbox.click();
    });
    await act(async () => {
      perTesto('Chiudi').click();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/affiliazione/spot', { method: 'POST' });
  });

  it('col cookie di sessione già presente non interroga nemmeno il server', async () => {
    // È il ramo che vale per quasi tutte le navigazioni: la chrome rimonta a
    // ogni cambio rotta, ma la modale non deve riaprirsi né rifare la fetch.
    document.cookie = `${AFF_SPOT_COOKIE}=1; path=/`;

    await render();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
