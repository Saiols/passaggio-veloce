import { Alert } from '@/components/ui';
import { statoSospensione } from '@/lib/auth/sospensione-guard';

/**
 * Banner della sospensione. Server Component senza prop: legge il contesto,
 * già `cache()`-ato per richiesta, e si auto-annulla quando non c'è nulla da
 * dire — come VisuraBanner e DemoBanner.
 *
 * Il motivo è testo libero scritto dall'admin: va reso SOLO come figlio JSX
 * (React lo escapa). Mai `dangerouslySetInnerHTML`.
 */
export async function SuspensionBanner() {
  const s = await statoSospensione();
  if (!s.sospeso) return null;

  const soggetto =
    s.origine === 'AZIENDA'
      ? "L'account della tua azienda è sospeso"
      : 'La tua utenza è sospesa';

  return (
    <Alert variant="error" title={`${soggetto} — operazioni bloccate`}>
      Puoi consultare lo storico delle pratiche, il wallet, le fatture e gli addebiti, ma non puoi
      creare o gestire pratiche, prelevare dal wallet o modificare le impostazioni. Il saldo del
      wallet resta a tuo credito.{' '}
      {s.motivo ? <>Motivo indicato da Passaggio Veloce: «{s.motivo}».{' '}</> : null}
      Per chiedere il riesame della misura rispondi all&apos;email che hai ricevuto.
    </Alert>
  );
}
