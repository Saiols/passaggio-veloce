import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Lo scanner documenti trascina canvas/pdf/worker: non serve al test dell'id,
// lo neutralizziamo. Restituisce un `pick` no-op e un modal nullo.
vi.mock('@/components/document-scanner-modal', () => ({
  useDocumentScanner: () => ({ pick: () => {}, modal: null }),
  routeSelection: () => 'noop',
}));

import { UploadCard } from './upload-card';

/** Estrae tutti gli id degli <input type="file"> dal markup renderizzato. */
function inputFileIds(html: string): string[] {
  const ids: string[] = [];
  const re = /<input[^>]*\btype="file"[^>]*>/g;
  for (const tag of html.match(re) ?? []) {
    const m = tag.match(/\bid="([^"]*)"/);
    if (m) ids.push(m[1]);
  }
  return ids;
}

/** Estrae tutti i for="..." dei <label>. */
function labelForTargets(html: string): string[] {
  const targets: string[] = [];
  const re = /<label[^>]*\bfor="([^"]*)"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) targets.push(m[1]);
  return targets;
}

describe('UploadCard — unicità id file input (co-intestatari)', () => {
  it('due card con la STESSA label producono id di input DIVERSI', () => {
    // Riproduce il caso reale: venditore 1 e venditore 2 (o acquirente +
    // co-intestatario) hanno entrambi una card "Fronte" nello stesso DOM.
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(UploadCard, {
          label: 'Fronte',
          slot: undefined,
          onSelect: () => {},
          onRemove: () => {},
        }),
        createElement(UploadCard, {
          label: 'Fronte',
          slot: undefined,
          onSelect: () => {},
          onRemove: () => {},
        }),
      ),
    );

    const ids = inputFileIds(html);
    expect(ids).toHaveLength(2);
    // Il difetto: id derivato solo dalla label → due "upload-fronte" identici.
    // Con id duplicati, <label for="upload-fronte"> attiva SEMPRE il primo
    // input nel DOM, quindi il file scelto per la 2ª card finisce sulla 1ª.
    expect(new Set(ids).size).toBe(2);
  });

  it('ogni <label for> punta a un id di input presente nella propria card', () => {
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(UploadCard, {
          label: 'Fronte',
          slot: undefined,
          onSelect: () => {},
          onRemove: () => {},
        }),
        createElement(UploadCard, {
          label: 'Fronte',
          slot: undefined,
          onSelect: () => {},
          onRemove: () => {},
        }),
      ),
    );

    const ids = inputFileIds(html);
    const fors = labelForTargets(html);
    // Ogni target di label deve corrispondere a un input esistente…
    for (const f of fors) expect(ids).toContain(f);
    // …e non ci devono essere id duplicati tra i target (altrimenti la 2ª label
    // colpirebbe il 1° input).
    expect(new Set(fors).size).toBe(fors.length);
  });
});
