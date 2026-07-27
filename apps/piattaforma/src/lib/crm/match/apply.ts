import 'server-only';
import { prisma, CrmFonteAcquisizione, type Prisma } from '@pv/db';
import { calcolaProposte, type Proposta } from './engine';
import { datiFunnel } from './stato';
import { storicoAzienda } from './storico';

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
};

export async function applicaProposte(
  proposte: Proposta[],
): Promise<EsitoApply> {
  let agganciati = 0;
  let saltati = 0;
  let errori = 0;

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
        select: { status: true },
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
      if (res.count > 0) agganciati++;
      else saltati++;
    } catch (err) {
      console.error(`[applicaProposte] errore su contatto ${p.contactId}:`, err);
      errori++;
    }
  }

  return { agganciati, saltati, errori };
}

export type EsitoRiconciliazione = EsitoApply & { proposte: number };

/** Passata completa: calcola e applica. Usata dal cron e dall'azione admin. */
export async function riconciliaTutto(): Promise<EsitoRiconciliazione> {
  const proposte = await calcolaProposte();
  const esito = await applicaProposte(proposte);
  return { proposte: proposte.length, ...esito };
}
