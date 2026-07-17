import Link from 'next/link';
import { Alert } from '@/components/ui';
import { getStatoVisura } from '@/lib/visura/stato';
import { VISURA_VALIDITA_GIORNI } from '@/lib/visura/validita';

/**
 * Banner del ciclo di vita visura. Server Component: legge lo stato derivato e
 * si auto-annulla quando non c'è nulla da dire (OK / ESENTE), come DemoBanner.
 */
export async function VisuraBanner({
  companyId,
  companyType,
}: {
  companyId: string;
  companyType: 'DEALER' | 'AGENZIA';
}) {
  const s = await getStatoVisura(companyId);
  if (s.stato === 'OK' || s.stato === 'ESENTE') return null;

  // AGENZIA: la scadenza somma il blocco operativo al blocco payout. DEALER:
  // il broker continua a creare/gestire pratiche — l'UNICA conseguenza è il
  // wallet (vedi commento in `eseguiPayoutImmediato`, `lib/wallet/payout-exec.ts`).
  //
  // Due varianti temporali, non una sola: in SCADUTA il blocco è già in atto
  // (presente), in PREAVVISO scatterà solo dopo la scadenza (futuro) — usare
  // il presente in PREAVVISO prometterebbe un blocco che non c'è ancora.
  if (s.stato === 'SCADUTA') {
    const conseguenza =
      companyType === 'AGENZIA'
        ? 'non puoi gestire pratiche, non ne ricevi di nuove e non puoi prelevare dal wallet'
        : 'non puoi prelevare il saldo del tuo wallet';
    return (
      <Alert variant="error" title="Visura camerale scaduta — operazioni bloccate">
        La tua visura è stata emessa {s.giorniTrascorsi} giorni fa e ha superato i{' '}
        {VISURA_VALIDITA_GIORNI} giorni di validità: ci serve aggiornata per poterti fatturare
        correttamente. Finché non la carichi, {conseguenza}.{' '}
        <Link href="/visura" className="font-semibold underline">
          Aggiorna la visura
        </Link>{' '}
        — lo sblocco è immediato.
      </Alert>
    );
  }

  const conseguenzaFutura =
    companyType === 'AGENZIA'
      ? 'non potrai gestire pratiche, non ne riceverai di nuove e non potrai prelevare dal wallet'
      : 'non potrai prelevare il saldo del tuo wallet';
  // Finestra di preavviso 1..5 giorni (PREAVVISO_GIORNI): il singolare si
  // presenta davvero (l'ultimo giorno prima della scadenza), non è un caso
  // di bordo teorico da ignorare.
  const giornoOGiorni = s.giorniRimanenti === 1 ? 'giorno' : 'giorni';
  return (
    <Alert variant="warning" title="La visura camerale sta per scadere">
      Mancano {s.giorniRimanenti} {giornoOGiorni} alla scadenza. Dopo, {conseguenzaFutura}.{' '}
      <Link href="/visura" className="font-semibold underline">
        Aggiornala ora
      </Link>
      .
    </Alert>
  );
}
