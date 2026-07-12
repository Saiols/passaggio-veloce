import { Alert } from '@/components/ui';

/**
 * Consigli sulla qualità delle foto dei documenti. Va mostrato UNA VOLTA PER
 * STEP (non per persona/veicolo), sopra l'area di upload.
 *
 * Il messaggio sulla fotocamera descrive un comportamento che ESISTE GIÀ: l'input
 * di UploadCard accetta `image/jpeg,image/png`, quindi il picker nativo di iOS e
 * Android offre già "Scatta foto". Deliberatamente NON usiamo l'attributo
 * `capture`: su molti browser mobile forza la fotocamera e toglie la scelta della
 * galleria, penalizzando chi la foto ce l'ha già.
 */
export function BannerFotoDocumenti() {
  return (
    <Alert variant="info" title="Come fotografare i documenti">
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        <li>
          Foto <strong>nitide e ben illuminate</strong>, con il documento{' '}
          <strong>intero</strong> nell&apos;inquadratura.
        </li>
        <li>
          Evita riflessi, ombre e foto storte: se il testo non si legge, i dati non
          vengono compilati in automatico.
        </li>
        <li>
          <strong>Da telefono puoi scattare la foto direttamente</strong>: tocca
          &quot;Carica file&quot; e scegli la fotocamera. Poi puoi ritagliarla e
          raddrizzarla nell&apos;editor.
        </li>
      </ul>
    </Alert>
  );
}
