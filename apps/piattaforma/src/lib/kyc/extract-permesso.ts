/**
 * Parser best-effort del permesso di soggiorno: estrae cognome, nome e data di
 * scadenza dal testo OCR. I permessi hanno layout bilingue (IT/EN) e formati
 * eterogenei → da calibrare su documenti reali. Puro/testabile.
 */
export type PermessoData = { nome?: string; cognome?: string; scadenza?: string };

const NAME = String.raw`([A-ZÀ-Ù'’]{2,}(?:[ '’][A-ZÀ-Ù'’]{2,}){0,3})`;

function clean(s: string | undefined): string | undefined {
  const v = s?.replace(/\s+/g, ' ').trim();
  return v && v.length ? v : undefined;
}

export function parsePermessoText(text: string): PermessoData {
  const up = text.toUpperCase();

  // Etichette bilingui "COGNOME / SURNAME", "NOME / NAME" seguite dal valore
  // (eventualmente a capo). Consuma il sinonimo inglese se presente.
  const cognome = clean(
    new RegExp(String.raw`\b(?:COGNOME|SURNAME)\b[\s:/]*(?:SURNAME\b[\s:/]*)?` + NAME).exec(up)?.[1],
  );
  const nome = clean(
    new RegExp(String.raw`\bNOME\b[\s:/]*(?:NAME\b[\s:/]*)?` + NAME).exec(up)?.[1],
  );

  const sc =
    /(?:SCADENZA|VALIDO FINO AL|DATA DI SCADENZA|VALIDIT[AÀ]|DATE OF EXPIRY|EXPIR[A-Z]*)[\s\S]{0,20}?(\d{2})[/.\-](\d{2})[/.\-](\d{4})/.exec(
      up,
    );
  const scadenza = sc ? `${sc[3]}-${sc[2]}-${sc[1]}` : undefined;

  return { nome, cognome, scadenza };
}
