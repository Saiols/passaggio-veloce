// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useFieldErrorsState } from './field-errors-state';

// Sonda: espone il risultato dell'hook su un oggetto esterno per poterlo pilotare.
function makeProbe(errors: Record<string, string | undefined>) {
  const api: { current: ReturnType<typeof useFieldErrorsState> | null } = { current: null };
  function Probe() {
    api.current = useFieldErrorsState(errors);
    const f = api.current.field('email');
    return <span data-invalid={f.invalid ? '1' : '0'} data-error={f.error ?? ''} />;
  }
  return { api, Probe };
}

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

describe('useFieldErrorsState', () => {
  it("all'apertura nessun campo è in errore, anche con errori presenti", () => {
    const { Probe } = makeProbe({ email: 'Email non valida' });
    render(<Probe />);
    expect(host!.querySelector('span')!.getAttribute('data-invalid')).toBe('0');
    expect(host!.querySelector('span')!.getAttribute('data-error')).toBe('');
  });

  it('onBlur di un campo lo rende invalido con messaggio', () => {
    const { api, Probe } = makeProbe({ email: 'Email non valida' });
    render(<Probe />);
    act(() => api.current!.field('email').onBlur());
    expect(host!.querySelector('span')!.getAttribute('data-invalid')).toBe('1');
    expect(host!.querySelector('span')!.getAttribute('data-error')).toBe('Email non valida');
  });

  it('gatedSubmit con errori fa reveal e NON chiama onValid', () => {
    let called = false;
    const { api, Probe } = makeProbe({ email: 'Email non valida' });
    render(<Probe />);
    act(() => api.current!.gatedSubmit(() => { called = true; })({ preventDefault() {} }));
    expect(called).toBe(false);
    expect(host!.querySelector('span')!.getAttribute('data-invalid')).toBe('1');
  });

  it('gatedSubmit senza errori chiama onValid', () => {
    let called = false;
    const { api, Probe } = makeProbe({});
    render(<Probe />);
    act(() => api.current!.gatedSubmit(() => { called = true; })({ preventDefault() {} }));
    expect(called).toBe(true);
  });
});
