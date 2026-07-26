import 'server-only';
import { prisma } from '@pv/db';
import { createDocBroker } from '@/lib/fatturazione/engine';
import { createGiustificativoPromo } from '@/lib/fatturazione/giustificativo-promo';
import { getPayment } from '@/lib/providers/payment';
import { isVisuraScadutaCompany } from '@/lib/visura/stato';
import { WALLET } from './config';
import { ERRORE_PAYOUT_SOSPESO, payoutBloccatoPerSospensione } from './sospensione-payout';

export type EseguiPayoutResult =
  | { ok: true; payoutId: string; importoCent: number }
  | { ok: false; error: string };

/**
 * Tipi di transazione-credito che compongono il compenso maturato e che,
 * al payout, vengono agganciati al payout stesso: è ciò che alimenta il
 * documento broker conto terzi (FT-A). Promo e penali NON sono compensi per
 * servizi resi e restano fuori dall'aggregazione documentale (pur concorrendo
 * al saldo cassa erogato).
 */
const TIPI_CREDITO_COMPENSO = ['CREDITO_PRATICA', 'CREDITO_AFFILIAZIONE'] as const;
// Il promo NON è compenso (resta fuori dal documento broker), ma va agganciato
// al payout per generare il giustificativo interno di costo (Documento 2).
const TIPI_AGGANCIATI_AL_PAYOUT = [...TIPI_CREDITO_COMPENSO, 'CREDITO_PROMO'] as const;

/** IBAN su cui erogare: wallet di sede → IBAN sede con fallback madre; wallet madre → IBAN madre. */
function resolveIban(wallet: {
  sede: { iban: string | null; company: { iban: string | null } } | null;
  company: { iban: string | null } | null;
}): string {
  return (
    (wallet.sede ? (wallet.sede.iban ?? wallet.sede.company.iban) : wallet.company?.iban) ?? ''
  );
}

/**
 * Esegue il bonifico di un Payout già creato (stato RICHIESTO/IN_LAVORAZIONE)
 * PASSANDO DAL PROVIDER DI PAGAMENTO, poi lo salda. Punto UNICO di settlement,
 * condiviso dal payout istantaneo e dal job `processPayouts`:
 *
 *  1. risolve l'IBAN (manca → Payout FALLITO, nessun addebito);
 *  2. chiama `payment.executePayout` FUORI dalla transazione DB — qui vive il
 *     safeguard go-live (con chiavi `sk_live` e Strada B non pronta il provider
 *     rifiuta → Payout FALLITO, il wallet NON viene svuotato);
 *  3. solo su esito ok: in una transazione aggancia i compensi maturati, azzera
 *     il saldo, registra il movimento e marca ESEGUITO; poi genera il documento
 *     broker (best-effort, idempotente).
 *
 * In mock/test `executePayout` è un no-op che ritorna ok → l'erogazione resta
 * istantanea (nessun bonifico reale: Strada B manuale, fuori piattaforma).
 */
export async function settlePayout(payoutId: string): Promise<EseguiPayoutResult> {
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
    include: {
      wallet: {
        include: {
          sede: { select: { iban: true, company: { select: { iban: true } } } },
          company: { select: { iban: true } },
        },
      },
    },
  });
  if (!payout) return { ok: false, error: 'Payout non trovato' };

  const iban = resolveIban(payout.wallet);
  if (!iban) {
    await prisma.payout.update({
      where: { id: payoutId },
      data: { stato: 'FALLITO', errorMessage: 'IBAN mancante', fallitoAt: new Date() },
    });
    return {
      ok: false,
      error: 'IBAN mancante: configuralo nel profilo per ricevere i pagamenti.',
    };
  }

  // Chiamata al provider FUORI da qualsiasi transazione DB (no external call in tx).
  const result = await getPayment().executePayout({
    payoutId,
    importoCent: payout.importoCent,
    iban,
  });

  if (!result.ok) {
    await prisma.payout.update({
      where: { id: payoutId },
      data: { stato: 'FALLITO', errorMessage: result.error, fallitoAt: new Date() },
    });
    return { ok: false, error: result.error };
  }

  await prisma.$transaction(async (tx) => {
    // Aggancia al payout i compensi (pratiche + affiliazione) E il promo: solo i
    // compensi alimentano il documento broker (createDocBroker filtra per tipo), il
    // promo alimenta il giustificativo interno (createGiustificativoPromo).
    await tx.transazioneWallet.updateMany({
      where: { walletId: payout.walletId, payoutId: null, tipo: { in: [...TIPI_AGGANCIATI_AL_PAYOUT] } },
      data: { payoutId },
    });
    const wallet = await tx.wallet.update({
      where: { id: payout.walletId },
      data: { saldoCent: { decrement: payout.importoCent } },
    });
    await tx.transazioneWallet.create({
      data: {
        walletId: payout.walletId,
        tipo: payout.automatico ? 'PAYOUT_AUTOMATICO' : 'PAYOUT_MANUALE',
        importoCent: -payout.importoCent,
        saldoPostCent: wallet.saldoCent,
        payoutId,
      },
    });
    await tx.payout.update({
      where: { id: payoutId },
      data: {
        stato: 'ESEGUITO',
        providerRef: result.providerRef,
        eseguitoAt: new Date(),
        errorMessage: null,
      },
    });
  });

  // FT-A: documento broker (conto terzi) aggregato al payout (best-effort).
  await createDocBroker({ payoutId }).catch(() => undefined);
  // Documento 2: giustificativo interno di costo per il bonus promo (best-effort).
  await createGiustificativoPromo({ payoutId }).catch(() => undefined);

  return { ok: true, payoutId, importoCent: payout.importoCent };
}

/**
 * Richiesta payout ISTANTANEA per il wallet indicato: senza approvazione admin
 * e senza attendere il job, la richiesta viene eseguita subito. Passa comunque
 * dal provider di pagamento (vedi `settlePayout`), così il safeguard go-live
 * copre anche questo path.
 *
 * Reserve + settle in due passi (non una singola transazione) perché la
 * chiamata al provider non può stare dentro una transazione DB: prima crea il
 * Payout IN_LAVORAZIONE (che fa anche da lock anti-doppione), poi lo salda.
 */
export async function eseguiPayoutImmediato(
  walletId: string,
  opts: { automatico?: boolean; ignoraSoglia?: boolean } = {},
): Promise<EseguiPayoutResult> {
  const automatico = opts.automatico ?? false;
  // Solo per la liquidazione del residuo alla cessazione del rapporto
  // (clausole 5 e 12.4 dei Termini). NON raggiungibile dal path utente.
  const ignoraSoglia = opts.ignoraSoglia ?? false;

  // Ciclo di vita della visura camerale (clausola 8 dei Termini): senza una
  // visura aggiornata PV non può fatturare correttamente (anche il documento
  // broker conto terzi, clausola 6), quindi i payout restano sospesi finché
  // l'azienda non la aggiorna — la via d'uscita esiste già (/visura). Per il
  // broker questa è l'UNICA conseguenza (continua a creare/gestire pratiche);
  // per l'agenzia si somma al blocco operativo (guard separato, altrove).
  // `isVisuraScadutaCompany` usa `prisma`, non `tx`: va risolta PRIMA di
  // aprire la transazione di reserve, altrimenti annideremmo una query non
  // transazionale dentro `$transaction`.
  //
  // Escluso per `ignoraSoglia` (liquidazione di cessazione, clausola 12.4:
  // "il saldo residuo è liquidato integralmente"): a differenza del saldo
  // negativo — che È un debito verso PV e resta verificato anche in questo
  // flusso (guard sotto) — una visura scaduta non è un debito. E qui
  // l'utente non può più sanarla: `deleteCompanyAction` marca l'azienda
  // `deletedAt` e i suoi utenti `SUSPENDED`, mentre il login richiede
  // `deletedAt: null` e `status != SUSPENDED` (`credentials-query.ts`), quindi
  // `/visura` (che richiede una sessione) diventa irraggiungibile nello
  // stesso istante in cui questo guard scatterebbe. Bloccare qui
  // intrappolerebbe il denaro dovuto per sempre: `reactivateCompanyAction`
  // azzera `suspendedAt` ma mai `deletedAt` (irreversibile da UI), e il
  // chiamante (`deleteCompanyAction`) scarta l'esito con
  // `.catch(() => undefined)` — un rifiuto qui sparirebbe in silenzio, senza
  // log né notifica.
  if (!ignoraSoglia) {
    const walletOwner = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: {
        companyId: true,
        company: { select: { suspendedAt: true } },
        sede: { select: { companyId: true, company: { select: { suspendedAt: true } } } },
      },
    });
    const ownerCompanyId = walletOwner?.companyId ?? walletOwner?.sede?.companyId ?? null;

    // Sospensione dell'AZIENDA (non dell'utente): un payout è un movimento di
    // denaro aziendale, e se è sospeso un solo utente i colleghi restano
    // legittimati. L'utente sospeso singolarmente non può comunque arrivare
    // qui dall'action, perché `wallet.payout` è una chiave di scrittura.
    //
    // ⚠️ GUARD DI TRIO: questa funzione NON è l'unico percorso che crea o salda
    // un payout. `lib/jobs/trigger-auto-payout.ts` (cron notturno) crea il
    // Payout `RICHIESTO` da sé; `lib/jobs/process-payouts.ts` lo salda via
    // `settlePayout`, che di suo non ha guard di dominio: un blocco solo qui
    // non ferma né il payout automatico (lo rimanda di una notte) né una riga
    // `RICHIESTO` già creata prima della sospensione (quella la paga
    // comunque). Il predicato è condiviso (./sospensione-payout.ts) proprio
    // per tenere visibile il trio — se aggiungi o cambi una condizione qui,
    // guarda anche là.
    //
    // Come il guard visura sotto, è escluso da `ignoraSoglia`: la liquidazione
    // di cessazione (clausola 12.4) deve restare possibile, e `deleteCompanyAction`
    // marca `suspendedAt` insieme a `deletedAt` — bloccare qui intrappolerebbe
    // per sempre il denaro dovuto.
    if (payoutBloccatoPerSospensione(walletOwner)) {
      return { ok: false, error: ERRORE_PAYOUT_SOSPESO };
    }

    if (ownerCompanyId && (await isVisuraScadutaCompany(ownerCompanyId))) {
      return {
        ok: false,
        error:
          'La visura camerale della tua azienda è scaduta: i prelievi sono sospesi finché non la aggiorni.',
      };
    }
  }

  const reserve = await prisma.$transaction(
    async (tx): Promise<{ ok: true; payoutId: string } | { ok: false; error: string }> => {
      // Serializzazione anti doppio-payout: prende un row lock Postgres sulla
      // riga wallet PRIMA di leggere lo stato e i payout in-flight. Senza,
      // due reserve concorrenti sullo stesso wallet leggerebbero entrambe
      // "nessun payout in corso" (READ COMMITTED) e creerebbero due Payout
      // IN_LAVORAZIONE per l'intero saldo → wallet svuotato due volte. Con il
      // `FOR UPDATE` la seconda reserve blocca finché la prima non committa,
      // poi la sua `findFirst(inflight)` vede il payout IN_LAVORAZIONE già
      // committato e rifiuta con "Payout già in corso".
      await tx.$queryRaw`SELECT id FROM "wallets" WHERE id = ${walletId}::uuid FOR UPDATE`;

      const wallet = await tx.wallet.findUnique({
        where: { id: walletId },
        select: { id: true, saldoCent: true },
      });
      if (!wallet) return { ok: false, error: 'Wallet non trovato' };
      // Un saldo <= 0 non è mai erogabile, nemmeno alla cessazione: non si
      // bonifica un debito.
      //
      // Clausola 5 dei Termini: il saldo negativo di un wallet blocca il
      // prelievo DA QUEL WALLET e basta. «Gli altri wallet dell'Utente (altre
      // sedi e wallet di affiliazione) non sono in alcun modo vincolati o
      // bloccati per effetto del saldo negativo di un singolo wallet.» Fino al
      // 2026-07-26 qui c'era un guard aziendale (`hasNegativeCompanyWallet`)
      // che sospendeva TUTTI i payout dell'azienda: il documento v8 dei Termini
      // lo ha eliminato, e con esso il guard. Resta in piedi il solo controllo
      // per-wallet — queste due righe.
      if (wallet.saldoCent <= 0) {
        return { ok: false, error: 'Saldo non erogabile' };
      }
      if (!ignoraSoglia && wallet.saldoCent < WALLET.MIN_PAYOUT_CENT) {
        return {
          ok: false,
          error: `Saldo sotto la soglia minima di ${WALLET.MIN_PAYOUT_CENT / 100}€`,
        };
      }

      const inflight = await tx.payout.findFirst({
        where: { walletId, stato: { in: ['RICHIESTO', 'IN_LAVORAZIONE'] } },
        select: { id: true },
      });
      if (inflight) return { ok: false, error: 'Payout già in corso, attendi' };

      const payout = await tx.payout.create({
        data: {
          walletId,
          importoCent: wallet.saldoCent,
          stato: 'IN_LAVORAZIONE',
          automatico,
        },
      });
      return { ok: true, payoutId: payout.id };
    },
  );

  if (!reserve.ok) return reserve;
  return settlePayout(reserve.payoutId);
}
