import type { CompanyType, RegimeFiscale } from '@pv/db';
import { Alert } from '@/components/ui';
import { fatturaPaTipoPerRegime } from '@/lib/fatturazione/calcolo';

/**
 * Banner della pagina Fatture: dice a broker e agenzie che non devono emettere
 * nulla — i documenti li genera PV (fatturazione delegata, art. 21 c. 2 DPR
 * 633/72) — e dove li ritrovano.
 *
 * NON è un testo fisso: la promessa "lo trovi nel cassetto fiscale" vale solo
 * per i documenti che vanno davvero allo SdI. Il DOC_BROKER di un broker in
 * regime PRIVATO è una ricevuta NON fiscale (`fatturaPaTipoPerRegime` → null,
 * calcolo.ts:37-41): nel cassetto fiscale non ci arriverà mai, e prometterglielo
 * lo manderebbe a cercare per settimane un documento che non esiste.
 *
 * Il discriminante lo CHIEDIAMO a `fatturaPaTipoPerRegime` invece di ricopiare
 * qui l'elenco dei regimi: se domani il forfettario cambia trattamento, il testo
 * segue la fiscalità da solo.
 */
export function BannerFatturazioneAutomatica({
  ruolo,
  regime,
}: {
  ruolo: Extract<CompanyType, 'AGENZIA' | 'DEALER'>;
  regime: RegimeFiscale;
}) {
  if (ruolo === 'AGENZIA') {
    return (
      <Alert variant="info" title="Le fatture le emettiamo noi" className="mb-5">
        Non devi emettere né richiedere niente: a ogni pratica conclusa Passaggio Veloce genera
        automaticamente i documenti fiscali. Quelli elettronici li ricevi nel tuo cassetto fiscale;
        qui trovi sempre PDF e XML da scaricare e girare al commercialista.
      </Alert>
    );
  }

  // Broker: PV emette il documento PER SUO CONTO. Finisce allo SdI solo se il
  // suo regime lo prevede.
  const vaAlloSdi = fatturaPaTipoPerRegime('DOC_BROKER', regime) !== null;

  if (!vaAlloSdi) {
    return (
      <Alert variant="info" title="I documenti li emettiamo noi per tuo conto" className="mb-5">
        Non devi emettere niente: a ogni pratica conclusa Passaggio Veloce genera il documento per
        tuo conto. Operando senza partita IVA il tuo è una <strong>ricevuta non fiscale</strong>:
        non passa dalla fatturazione elettronica, quindi non la troverai nel cassetto fiscale — la
        scarichi da qui.
      </Alert>
    );
  }

  return (
    <Alert variant="info" title="Le fatture le emettiamo noi per tuo conto" className="mb-5">
      Non devi emettere fattura: a ogni pratica conclusa Passaggio Veloce genera il documento per
      tuo conto e lo manda alla fatturazione elettronica, così lo ritrovi nel tuo cassetto fiscale.
      Qui puoi scaricarne PDF e XML in qualsiasi momento.
    </Alert>
  );
}
