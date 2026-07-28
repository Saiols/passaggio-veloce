import 'server-only';
import { prisma, type Prisma } from '@pv/db';
import {
  normDaPatch,
  unisciArricchitoDa,
  type ContattoDaArricchire,
  type PatchArricchimento,
} from './arricchimento';

/**
 * Applica la patch calcolata da `calcolaArricchimento`.
 *
 * Compare-and-set sui campi stessi: si scrive solo se ognuno ha ancora il
 * valore che aveva alla lettura. Fra il calcolo e la scrittura passano altri
 * round-trip, ed è la stessa finestra in cui un admin può compilare l'email a
 * mano dal pannello contatti; senza guardia il cron notturno gliela
 * sovrascriverebbe con quella della registrazione, in silenzio.
 *
 * Il confronto è sul valore letto e NON su `null`/`''`: un campo di soli
 * spazi conta come vuoto per `calcolaArricchimento`, e una guardia scritta
 * come `OR: [{ campo: null }, { campo: '' }]` non lo troverebbe — `count`
 * tornerebbe 0 per sempre senza che nulla lo segnali.
 *
 * `arricchitoDa: letto.arricchitoDa` è nel `where` per lo stesso motivo per
 * cui `apply.ts` rimette `status: attuale.status` nella propria guardia
 * (vedi i commenti lì, righe ~76-91): senza, due scritture concorrenti su
 * campi diversi dello stesso contatto (es. un giro che riempie `citta`, un
 * altro che riempie `wa` sulla lettura precedente) supererebbero entrambe la
 * CAS sui *loro* campi e l'ultima a scrivere calcolerebbe `arricchitoDa` a
 * partire dall'`arricchitoDa` ormai stantio che ha letto lei — cancellando la
 * voce che l'altra aveva appena aggiunto. I valori dei campi resterebbero
 * corretti, ma il badge che mostra "riempito in automatico" mentirebbe in
 * silenzio. Mettere `arricchitoDa` nel `where` fa fallire l'INTERA scrittura
 * (campi dati compresi) quando cambia fra lettura e scrittura: quei campi
 * restano buchi e li riprende la passata successiva del cron. Nessun retry
 * qui — un giro di ritardo in un caso raro è preferibile a un audit che mente.
 *
 * `deletedAt: null` per lo stesso motivo di `apply.ts`: non si scrive su una
 * riga cancellata contandola come arricchita.
 */
export async function applicaArricchimento(
  contactId: string,
  patch: PatchArricchimento,
  letto: ContattoDaArricchire & { arricchitoDa: string | null },
): Promise<boolean> {
  const where: Prisma.CrmContactWhereInput = {
    id: contactId,
    deletedAt: null,
    arricchitoDa: letto.arricchitoDa,
    ...Object.fromEntries(patch.campi.map((c) => [c, letto[c]])),
  };

  const res = await prisma.crmContact.updateMany({
    where,
    data: {
      ...patch.dati,
      ...normDaPatch(patch),
      arricchitoDa: unisciArricchitoDa(letto.arricchitoDa, patch.campi),
      arricchitoAt: new Date(),
    },
  });
  return res.count > 0;
}
