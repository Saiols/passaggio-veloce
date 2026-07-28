import type { Proposta } from '@/lib/crm/match/engine';

/**
 * Review giro 1/5 (Finding 1, Important): le props passate da un Server
 * Component a un Client Component finiscono per intero nel payload RSC
 * spedito al browser, a prescindere da cosa il componente renderizza
 * davvero. `Proposta.sorgente` porta l'anagrafica grezza di company e sede
 * (email, telefono, indirizzo, civico, città, CAP, provincia, P.IVA) — dati
 * di aziende terze che servono SOLO ad `apply.ts` per l'arricchimento
 * server-side (lib/crm/match/). `client.tsx` non la legge mai, ma prima di
 * questo modulo la riceveva comunque: fino a 100 righe di anagrafica
 * spedite ad ogni visita della pagina.
 *
 * `sorgente?: never` (non un semplice `Omit<Proposta, 'sorgente'>`) rende
 * l'errore impossibile da ripetere: se `Proposta` cresce di un altro campo
 * sensibile e la pagina lo passa al client senza convertirlo con
 * `propostaPerVista`, il typecheck fallisce QUI — non in silenzio a
 * runtime. Un `Omit` da solo non lo farebbe: TypeScript non fa l'excess
 * property check su un valore che non è un literal, quindi un
 * `Proposta[]` intero verrebbe accettato comunque da un `Omit<...>[]`.
 */
export type PropostaVista = Omit<Proposta, 'sorgente'> & { sorgente?: never };

/**
 * L'unico punto che decide cosa, di una proposta, arriva al browser. La
 * pagina admin (Server Component) lo chiama prima di passare le proposte a
 * `RiconciliazioneClient`.
 */
export function propostaPerVista(p: Proposta): PropostaVista {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- `sorgente` si
  // estrae per lasciarla fuori dal rest: è il modo in cui viene scartata.
  const { sorgente: _sorgente, ...vista } = p;
  return vista;
}
