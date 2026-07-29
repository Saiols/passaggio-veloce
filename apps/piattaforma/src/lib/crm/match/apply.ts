import 'server-only';
import { prisma, CrmFonteAcquisizione, type Prisma } from '@pv/db';
import { calcolaProposte, type Proposta } from './engine';
import { datiFunnel } from './stato';
import { storicoAzienda } from './storico';
import { calcolaArricchimento, SELECT_ARRICCHIMENTO } from './arricchimento';
import { applicaArricchimento } from './arricchimento-scrittura';
import { campiRichiamoDopoCambioStato } from '@/lib/crm/richiamo';

/**
 * Scrittura degli agganci proposti dal motore.
 *
 * Lo stato non viene messo a S7 e basta: un'azienda che opera da mesi verrebbe
 * mostrata come "iscritto inattivo" (spec D4). Si guarda lo storico reale —
 * quante pratiche ha firmato — e si allinea il funnel, solo in salita
 * (`datiFunnel` in `stato.ts`, fonte unica condivisa con `onPraticaFirmata`).
 */

export type EsitoApply = {
  agganciati: number;
  /** Proposte non scritte perché il compare-and-set non è passato. */
  saltati: number;
  errori: number;
  /** Contatti su cui l'aggancio ha anche riempito almeno un campo vuoto. */
  arricchiti: number;
};

export async function applicaProposte(
  proposte: Proposta[],
): Promise<EsitoApply> {
  let agganciati = 0;
  let saltati = 0;
  let errori = 0;
  let arricchiti = 0;

  for (const p of proposte) {
    try {
      // Lo stato attuale serve per non retrocedere. Viene anche rimesso nel
      // `where` della updateMany qui sotto (CAS piena su companyId+status):
      // fra questa lettura e la scrittura ci sono altri round-trip (storico
      // azienda), ed è la stessa finestra in cui un admin può portare il
      // contatto a S10 da un'altra richiesta. Senza ririleggere lo stato nel
      // `where`, quella scrittura vincerebbe sull'admin (lost update) — la
      // regola "S10 mai toccato" cadrebbe proprio nel modo che il
      // compare-and-set doveva prevenire.
      const attuale = await prisma.crmContact.findUnique({
        where: { id: p.contactId },
        // L'anagrafica arriva nella STESSA lettura che serviva per lo stato:
        // l'arricchimento non aggiunge nessun round-trip.
        select: { status: true, ...SELECT_ARRICCHIMENTO },
      });
      if (!attuale) {
        saltati++;
        continue;
      }

      const storico = await storicoAzienda(p.companyId, p.cat);
      if (!storico) {
        saltati++;
        continue;
      }

      const funnel = datiFunnel(attuale.status, storico);
      const data: Prisma.CrmContactUncheckedUpdateManyInput = {
        companyId: p.companyId,
        sedeId: p.sedeId,
        matchVia: p.campi.join('+'),
        matchedAt: new Date(),
        iscrizioneComp: true,
        // Data REALE di registrazione dell'identità agganciata: per un match
        // su una sede è il createdAt della sede, non quello della madre
        // (spec §apply.ts). Arriva dal motore insieme alla proposta.
        iscrizioneAt: p.registrataAt,
        status: funnel.status as Prisma.CrmContactUncheckedUpdateManyInput['status'],
        platStatus: funnel.platStatus,
        primaPratica: funnel.primaPratica,
        primaPraticaAt: funnel.primaPraticaAt,
        // Il contatto era da richiamare e adesso è un cliente: il promemoria
        // commerciale non ha più oggetto.
        ...campiRichiamoDopoCambioStato(attuale.status, funnel.status),
      };
      // Arricchimento già vivo prima di questo lavoro: se la Company è arrivata
      // da un referral la fonte diventa REFERRAL. Altrimenti `fonte` non si
      // tocca, per non perdere lo storico del lead (es. CSV_INIZIALE).
      if (storico.referral) data.fonte = CrmFonteAcquisizione.REFERRAL;

      // Compare-and-set: si scrive solo se nessun altro giro l'ha già preso
      // (companyId ancora null), se lo stato è ancora quello appena letto
      // (nessuno l'ha spostato nel frattempo, es. a S10) e se la riga non è
      // stata cancellata fra il calcolo e la scrittura. `deletedAt: null` è lo
      // stesso predicato dei candidati in engine.ts e dell'indice unico
      // parziale: i tre devono coincidere, altrimenti si scrive su una riga
      // cancellata e la si conta come agganciata. Se una delle condizioni è
      // cambiata, `count` torna 0: niente sovrascrittura silenziosa, la
      // proposta semplicemente non si applica in questo giro.
      const res = await prisma.crmContact.updateMany({
        where: {
          id: p.contactId,
          companyId: null,
          deletedAt: null,
          status: attuale.status,
        },
        data,
      });
      if (res.count > 0) {
        agganciati++;
        // Best-effort e in un try/catch PROPRIO: l'aggancio è già scritto,
        // un errore qui non deve trasformarlo in un errore né in un salto.
        try {
          const patch = calcolaArricchimento(attuale, p.sorgente);
          if (patch && (await applicaArricchimento(p.contactId, patch, attuale))) {
            arricchiti++;
          }
        } catch (err) {
          console.error(
            `[applicaProposte] arricchimento fallito su ${p.contactId}:`,
            err,
          );
        }
      } else saltati++;
    } catch (err) {
      console.error(`[applicaProposte] errore su contatto ${p.contactId}:`, err);
      errori++;
    }
  }

  return { agganciati, saltati, errori, arricchiti };
}

export type EsitoRiconciliazione = EsitoApply & {
  proposte: number;
  /** Proposte ambigue lasciate alla pagina admin (mai un tetto silenzioso). */
  ambigueSaltate: number;
};

/**
 * Passata completa: calcola e applica.
 *
 * Di default applica SOLO le proposte non ambigue. Una proposta ambigua è una
 * per cui esiste una rivale a pari punteggio (stesso contatto conteso da due
 * AZIENDE diverse, oppure stessa identità contesa da due contatti): lo
 * spareggio in `assign.ts` è deterministico ma arbitrario nel merito, e sui
 * dati reali 2.373 numeri di telefono sono condivisi da più righe della lista.
 * Il cron gira alle 02:00 e non esiste alcun percorso di sgancio: una scelta
 * arbitraria scritta lì è irreversibile. Le ambigue restano quindi
 * all'anteprima admin, dove una persona le vede marcate e decide.
 *
 * `includiAmbigue: true` è per l'azione della pagina admin: lì l'anteprima è
 * stata vista da un umano, quindi si applica tutto.
 */
export async function riconciliaTutto(
  opts: { includiAmbigue?: boolean } = {},
): Promise<EsitoRiconciliazione> {
  const proposte = await calcolaProposte();
  const daApplicare = opts.includiAmbigue
    ? proposte
    : proposte.filter((p) => !p.ambigua);
  const esito = await applicaProposte(daApplicare);
  return {
    proposte: proposte.length,
    ambigueSaltate: proposte.length - daApplicare.length,
    ...esito,
  };
}
