import 'server-only';
import { prisma } from '@pv/db';
import { createFatturaPv } from '@/lib/fatturazione/engine';
import { notificaFatturaDisponibile } from '@/lib/fatturazione/notifica-fattura';

const FINESTRA_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 30;
/**
 * Il percorso d'incasso ha già avuto il suo turno: `segnaFeeIncassato` porta il
 * fee a SUCCESS e SOLO DOPO apre la transazione che emette la fattura. Fra i due
 * momenti il fee è già `SUCCESS` e il documento non è ancora committato — una
 * passata di riconciliazione che guardasse lì dentro non troverebbe nulla ed
 * emetterebbe un SECONDO documento fiscale (l'unicità di `createFatturaPv` è un
 * findFirst + create, che a READ COMMITTED non regge due transazioni
 * concorrenti, e non esiste un unique su (praticaId, tipo) a fare da rete: per
 * le FATTURA_PV `emittenteCompanyId` è NULL e in Postgres i NULL sono distinti,
 * quindi lo @@unique del registro non le vincola). Due numeri progressivi
 * bruciati e una nota di credito da emettere a mano. Cinque minuti di grazia
 * costano un'ora di ritardo nel solo caso in cui l'emissione sia davvero
 * fallita, e chiudono la corsa senza migration.
 */
const GRAZIA_MS = 5 * 60 * 1000;

/**
 * Rete per gli incassi rimasti senza il loro documento o senza la loro email:
 * `createFatturaPv` fallita dopo un SUCCESS, oppure N53 non partita. Non si
 * annulla un incasso perché un PDF è andato storto — si recupera qui.
 *
 * Due rami indipendenti, ognuno filtrato A MONTE su chi ha davvero bisogno di
 * lavoro. Non è un dettaglio di stile: con `take: 30` su una finestra di 7
 * giorni, se i 30 più vecchi fossero già a posto la rete smetterebbe in
 * silenzio di guardare i casi nuovi al primo accenno di volume reale.
 *  1. fee SUCCESS la cui pratica non ha ancora una FATTURA_PV → emette;
 *  2. FATTURA_PV già emessa e PAGATA ma senza `inviatoEmailAt` → rimanda la N53.
 *
 * Inerte in modalità mock, per due motivi indipendenti: lì nessun fee arriva mai
 * a SUCCESS (primo ramo vuoto) e la valvola della firma emette documenti
 * `IN_ATTESA`, che il filtro `statoPagamento: 'PAGATA'` esclude (secondo ramo
 * vuoto). Se un domani si allargasse quel filtro, la riconciliazione comincerebbe
 * a rimandare per N53 fatture già consegnate in allegato alla N8.
 *
 * Non lancia mai: un guasto a metà passata viene loggato e la funzione ritorna
 * comunque, ma con i contatori del lavoro davvero fatto FINO A quel punto — non
 * azzerati. Il chiamante (il cron di process-fee-scheduled) ha già ottenuto e
 * restituito il risultato di `processFeeScheduled` — quel risultato non deve
 * mai andare perso perché questa passata di recupero, che gira nella stessa
 * richiesta, si è interrotta a metà.
 */
export async function riconciliaFattureIncassate(): Promise<{
  emesse: number;
  notificate: number;
}> {
  let emesse = 0;
  let notificate = 0;

  try {
    const ora = Date.now();
    const da = new Date(ora - FINESTRA_MS);
    const finoA = new Date(ora - GRAZIA_MS);

    // Ramo 1 — incassi senza fattura. Il filtro sulla relazione fa il lavoro in
    // una query sola: i 30 slot vanno tutti a pratiche davvero scoperte.
    const fees = await prisma.feeAddebito.findMany({
      where: {
        stato: 'SUCCESS',
        executedAt: { gte: da, lt: finoA },
        pratica: { documentiFiscali: { none: { tipo: 'FATTURA_PV' } } },
      },
      take: BATCH_SIZE,
      orderBy: { executedAt: 'asc' },
      select: { id: true },
    });

    for (const fee of fees) {
      const creato = await createFatturaPv({
        feeAddebitoId: fee.id,
        statoPagamento: 'PAGATA',
      }).catch((err) => {
        console.error(`[riconciliaFatture] emissione fallita per fee ${fee.id}:`, err);
        return null;
      });
      if (!creato) continue;
      emesse++;
      const inviata = await notificaFatturaDisponibile(creato.id).catch((err) => {
        console.error(`[riconciliaFatture] N53 fallita per documento ${creato.id}:`, err);
        return false;
      });
      if (inviata) notificate++;
    }

    // Ramo 2 — fatture emesse la cui N53 non è mai partita (o la cui
    // prenotazione è stata rilasciata da un invio esploso). Nessuna grazia qui:
    // la corsa col percorso d'incasso è già chiusa dalla prenotazione atomica
    // dentro `notificaFatturaDisponibile`, che fa vincere uno solo dei due.
    const documenti = await prisma.documentoFiscale.findMany({
      where: {
        tipo: 'FATTURA_PV',
        statoPagamento: 'PAGATA',
        inviatoEmailAt: null,
        emessoAt: { gte: da },
      },
      take: BATCH_SIZE,
      orderBy: { emessoAt: 'asc' },
      select: { id: true },
    });

    for (const doc of documenti) {
      const inviata = await notificaFatturaDisponibile(doc.id).catch((err) => {
        console.error(`[riconciliaFatture] N53 fallita per documento ${doc.id}:`, err);
        return false;
      });
      if (inviata) notificate++;
    }
  } catch (err) {
    console.error('[riconciliaFatture] passata interrotta:', err);
  }

  return { emesse, notificate };
}
