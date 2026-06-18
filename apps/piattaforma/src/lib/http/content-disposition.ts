/**
 * Costruisce un header `Content-Disposition: attachment` sicuro per HTTP.
 *
 * I valori degli header devono essere ByteString (Latin-1): un `filename` con
 * un carattere > U+00FF fa lanciare `new Response(...)` con
 *   «TypeError: Cannot convert argument to a ByteString because the character
 *    at index N has a value of V which is greater than 255»
 * => 500 sul download (e' il bug osservato su GET /api/fatturazione/<id>/xml,
 * dove il filename includeva la P.IVA emittente).
 *
 * Soluzione RFC 6266 / RFC 5987: un fallback ASCII tra virgolette + il
 * parametro `filename*` con il nome UTF-8 percent-encoded. I browser moderni
 * usano `filename*` (nome corretto), i client legacy il fallback ASCII; in
 * nessun caso il valore dell'header contiene byte fuori Latin-1.
 */
export function attachmentContentDisposition(filename: string): string {
  // Fallback ASCII: solo stampabili ASCII, niente quote/backslash/control.
  let ascii = '';
  for (const ch of filename) {
    const cp = ch.codePointAt(0) ?? 0;
    ascii += cp >= 0x20 && cp <= 0x7e && ch !== '"' && ch !== '\\' ? ch : '_';
  }
  if (ascii.length === 0) ascii = 'download';

  // filename*: UTF-8 percent-encoded secondo RFC 5987 (encodeURIComponent +
  // escape di ' ( ) * che restano leciti ma vanno codificati nel value).
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
