import { describe, it, expect, vi } from 'vitest';

const findFirst = vi.fn();
vi.mock('@pv/db', () => ({ prisma: { tariffaPiattaforma: { findFirst: (...a: unknown[]) => findFirst(...a) } } }));

import { getTariffarioCorrente } from './tariffario';
import { DEFAULT_TARIFFARIO } from './pricing';

describe('getTariffarioCorrente', () => {
  // Nota: reset del mock inline in ogni test (niente `beforeEach`). In
  // Vitest 4.1.5 un `beforeEach(() => findFirst.mockReset())` seguito da
  // un test che fa rigettare la promise del mock produce un falso
  // "unhandled rejection" anche quando il codice la cattura correttamente
  // (verificato isolando il caso in un file di debug usa-e-getta): il
  // reset fatto dentro l'hook lascia il tracking interno del mock in uno
  // stato che disallinea l'attribuzione della rejection al test corrente.
  // Chiamare `mockReset()` a inizio di ogni `it` evita il problema.

  it('fallback a DEFAULT quando non c\'è riga attiva', async () => {
    findFirst.mockReset();
    findFirst.mockResolvedValue(null);
    expect(await getTariffarioCorrente()).toEqual(DEFAULT_TARIFFARIO);
  });

  it('fallback a DEFAULT quando la query DB fallisce (fail-open)', async () => {
    // Nota memoizzazione: getTariffarioCorrente è avvolto in React cache().
    // In produzione (react-server) cache() memoizza per-request; nel build
    // 'react' risolto in questo ambiente di test (Node, no condizione
    // react-server) cache() è un pass-through puro (verificato leggendo
    // react/cjs/react.development.js: `exports.cache = fn => (...a) =>
    // fn.apply(null, a)`), quindi ogni chiamata invoca davvero la query:
    // nessun risultato cachato dal test precedente da isolare qui.
    findFirst.mockReset();
    findFirst.mockRejectedValue(new Error('db down'));
    expect(await getTariffarioCorrente()).toEqual(DEFAULT_TARIFFARIO);
  });
});
