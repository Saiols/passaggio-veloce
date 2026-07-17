import 'server-only';
import { prisma } from '@pv/db';
import { createDocBroker } from '@/lib/fatturazione/engine';
import { getPayment } from '@/lib/providers/payment';
import { isVisuraScadutaCompany } from '@/lib/visura/stato';
import { WALLET } from './config';
import { hasNegativeCompanyWallet } from './negative-wallet-guard';

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
    // Aggancia i compensi maturati (pratiche + affiliazione) a questo payout:
    // è ciò che il documento broker aggrega.
    await tx.transazioneWallet.updateMany({
      where: { walletId: payout.walletId, payoutId: null, tipo: { in: [...TIPI_CREDITO_COMPENSO] } },
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
      select: { companyId: true, sede: { select: { companyId: true } } },
    });
    const ownerCompanyId = walletOwner?.companyId ?? walletOwner?.sede?.companyId ?? null;
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
      const wallet = await tx.wallet.findUnique({
        where: { id: walletId },
        include: { sede: { select: { companyId: true } } },
      });
      if (!wallet) return { ok: false, error: 'Wallet non trovato' };
      // Un saldo <= 0 non è mai erogabile, nemmeno alla cessazione: non si
      // bonifica un debito.
      if (wallet.saldoCent <= 0) {
        return { ok: false, error: 'Saldo non erogabile' };
      }
      if (!ignoraSoglia && wallet.saldoCent < WALLET.MIN_PAYOUT_CENT) {
        return {
          ok: false,
          error: `Saldo sotto la soglia minima di ${WALLET.MIN_PAYOUT_CENT / 100}€`,
        };
      }

      // Clausola 5 dei Termini: finché un wallet qualsiasi dell'azienda (altra
      // sede, o il wallet madre) è in saldo negativo — tipicamente per una
      // penale, clausola 10.6 — TUTTI i payout dell'azienda sono sospesi, non
      // solo quelli del wallet in negativo. Il controllo qui sotto è saltato
      // per la liquidazione di cessazione (`ignoraSoglia`, clausola 12.4), ma
      // il debito NON viene ignorato in quel flusso: per la cessazione il
      // blocco è imposto a monte, a livello di intera azienda, dal chiamante
      // (`deleteCompanyAction`, cfr. negative-wallet-guard.ts), che non
      // richiama nemmeno questa funzione se esiste un wallet negativo.
      if (!ignoraSoglia) {
        const companyId = wallet.companyId ?? wallet.sede?.companyId ?? null;
        if (companyId && (await hasNegativeCompanyWallet(tx, companyId))) {
          return {
            ok: false,
            error:
              'Un wallet della tua azienda è in saldo negativo: i payout sono sospesi finché non torna positivo (clausola 5 dei Termini).',
          };
        }
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
