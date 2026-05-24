// Next 16 cerca esplicitamente twitter-image.* separato. Riusiamo l'OG.
// runtime esplicito: Next non riconosce il `runtime` re-esportato via barrel
// (build warning altrimenti). Duplicato per safety; deve restare allineato
// con opengraph-image.tsx.
export { default, alt, size, contentType } from './opengraph-image';
export const runtime = 'nodejs';
