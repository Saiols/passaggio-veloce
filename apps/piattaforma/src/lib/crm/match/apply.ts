import 'server-only';
import { prisma, CrmFonteAcquisizione, type Prisma } from '@pv/db';
import { calcolaProposte, type Proposta } from './engine';

/**
 * Scrittura degli agganci proposti dal motore.
 *
 * Lo stato non viene messo a S7 e basta: un'azienda che opera da mesi verrebbe
 * mostrata come "iscritto inattivo" (spec D4). Si guarda lo storico reale —
 * quante pratiche ha firmato — e si allinea il funnel, solo in salita.
 */

const ORDINE = [
  'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9',
] as const;

/**
 * Stato del contatto dato lo stato attuale e le pratiche firmate dall'azienda.
 * Mai indietro; S10 (churn, decisione umana) non si tocca.
 */
export function statoAllineato(attuale: string, firmate: number): string {
  if (attuale === 'S10') return 'S10';
  const target = firmate === 0 ? 'S7' : firmate === 1 ? 'S8' : 'S9';
  const iAttuale = ORDINE.indexOf(attuale as (typeof ORDINE)[number]);
  const iTarget = ORDINE.indexOf(target as (typeof ORDINE)[number]);
  if (iAttuale === -1) return target;
  return iAttuale > iTarget ? attuale : target;
}

type Storico = {
  registrataAt: Date;
  firmate: number;
  primaPraticaAt: Date | null;
  sospesa: boolean;
  referral: boolean;
};

async function storicoAzienda(
  companyId: string,
  cat: 'BROKER' | 'AGENZIA',
): Promise<Storico | null> {
  // Le pratiche di un'agenzia stanno su agenziaAssegnataId, non su brokerId.
  const wherePratica =
    cat === 'AGENZIA' ? { agenziaAssegnataId: companyId } : { brokerId: companyId };

  const [company, firmate, prima] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        createdAt: true,
        suspendedAt: true,
        deletedAt: true,
        referenteId: true,
      },
    }),
    prisma.pratica.count({
      where: { ...wherePratica, deletedAt: null, stato: 'FIRMATA' },
    }),
    prisma.pratica.findFirst({
      where: { ...wherePratica, deletedAt: null, stato: 'FIRMATA' },
      orderBy: { firmaAvvenutaAt: 'asc' },
      select: { firmaAvvenutaAt: true },
    }),
  ]);
  if (!company) return null;

  return {
    registrataAt: company.createdAt,
    firmate,
    primaPraticaAt: prima?.firmaAvvenutaAt ?? null,
    sospesa: !!company.suspendedAt || !!company.deletedAt,
    referral: !!company.referenteId,
  };
}

export async function applicaProposte(
  proposte: Proposta[],
): Promise<{ agganciati: number; errori: number }> {
  let agganciati = 0;
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
      if (!attuale) continue;

      const storico = await storicoAzienda(p.companyId, p.cat);
      if (!storico) continue;

      const data: Prisma.CrmContactUncheckedUpdateManyInput = {
        companyId: p.companyId,
        sedeId: p.sedeId,
        matchVia: p.campi.join('+'),
        matchedAt: new Date(),
        iscrizioneComp: true,
        iscrizioneAt: storico.registrataAt,
        status: statoAllineato(
          attuale.status,
          storico.firmate,
        ) as Prisma.CrmContactUncheckedUpdateManyInput['status'],
        platStatus: storico.sospesa
          ? 'SOSPESO'
          : storico.firmate > 0
            ? 'ATTIVO'
            : 'INATTIVO',
        primaPratica: storico.firmate > 0,
        primaPraticaAt: storico.primaPraticaAt,
      };
      // Arricchimento già vivo prima di questo lavoro: se la Company è arrivata
      // da un referral la fonte diventa REFERRAL. Altrimenti `fonte` non si
      // tocca, per non perdere lo storico del lead (es. CSV_INIZIALE).
      if (storico.referral) data.fonte = CrmFonteAcquisizione.REFERRAL;

      // Compare-and-set: si scrive solo se nessun altro giro l'ha già preso
      // (companyId ancora null) E se lo stato è ancora quello appena letto
      // (nessuno l'ha spostato nel frattempo, es. a S10). Se una delle due
      // condizioni è cambiata, `count` torna 0: niente sovrascrittura silenziosa,
      // la proposta semplicemente non si applica in questo giro.
      const res = await prisma.crmContact.updateMany({
        where: { id: p.contactId, companyId: null, status: attuale.status },
        data,
      });
      if (res.count > 0) agganciati++;
    } catch (err) {
      console.error(`[applicaProposte] errore su contatto ${p.contactId}:`, err);
      errori++;
    }
  }

  return { agganciati, errori };
}

/** Passata completa: calcola e applica. Usata dal cron e dall'azione admin. */
export async function riconciliaTutto(): Promise<{
  proposte: number;
  agganciati: number;
  errori: number;
}> {
  const proposte = await calcolaProposte();
  const esito = await applicaProposte(proposte);
  return { proposte: proposte.length, ...esito };
}
