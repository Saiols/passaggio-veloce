/**
 * Normalizzazione del numero di telefono per il dedup dei contatti CRM.
 * Pura e testabile. Tiene solo le cifre e normalizza il prefisso internazionale
 * italiano (0039/+39 → numero locale), così "+39 348 1234567", "0039 3481234567"
 * e "348 1234567" producono la stessa chiave. La soglia di lunghezza evita di
 * intaccare i prefissi mobili 39x (es. 391, 392) dei numeri locali a 10 cifre.
 */
export function normalizePhone(tel: string | null | undefined): string {
  if (!tel) return '';
  let d = tel.replace(/\D/g, '');
  if (d.startsWith('0039')) d = d.slice(4);
  else if (d.startsWith('39') && d.length > 10) d = d.slice(2);
  return d;
}
