'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { Alert, Button, Field, Input } from '@/components/ui';
import { LoadingOverlay } from '@/components/ui/loading-overlay';
import { DocCard } from '@/components/doc-card';
import { uploadToBlob, type BlobRef } from '@/lib/blob/upload-client';
import { VISURA_VALIDITA_GIORNI } from '@/lib/visura/validita';
import { useFieldErrorsState, zodFieldErrors } from '@/components/forms';
import { verificaVisuraAction, aggiornaVisuraAction, type SedeLegalePreview } from './actions';

type SedeForm = { indirizzo: string; civico: string; cap: string; citta: string; provincia: string };

const SEDE_VUOTA: SedeForm = { indirizzo: '', civico: '', cap: '', citta: '', provincia: '' };

// Duplicato di proposito: come `blocco-pagamento/client.tsx` (ibanFormSchema),
// il client valida per l'esperienza utente, il server (actions.ts) rivalida
// per la sicurezza — sono due schemi indipendenti che devono solo dire la
// stessa cosa, non lo stesso oggetto.
const sedeLegaleSchema = z.object({
  indirizzo: z.string().trim().min(2, "Inserisci l'indirizzo"),
  civico: z.string().trim().min(1, 'Inserisci il civico'),
  cap: z.string().trim().regex(/^\d{5}$/, 'Il CAP deve avere 5 cifre'),
  citta: z.string().trim().min(2, 'Inserisci la città'),
  provincia: z.string().trim().length(2, 'La provincia è di 2 lettere'),
});

/** "2026-07-01" → "01/07/2026". Manipolazione di stringa, niente `Date`/fuso:
 *  `dataEmissione` è già una data di calendario (yyyy-mm-dd), non un istante. */
function formatDataEmissione(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Precompila il form sede legale.
 *
 * Il parser (`sedeLegale`) restituisce l'indirizzo COMPLETO col civico dentro
 * (es. "VIA A. VOLTA 10": vedi `lib/kyc/visura-parser.ts`), non un civico
 * separato. Non lo si separa con una regex — vie che finiscono con un numero,
 * indirizzi "SNC" o con civici tipo "10/A" renderebbero il taglio automatico
 * inaffidabile, e un civico sbagliato è peggio di uno vuoto perché finisce in
 * fattura senza che sembri richiedere revisione. Si lascia `civico` vuoto e lo
 * scrive il titolare, che sta già rivedendo l'indirizzo per confermarlo.
 *
 * Se il parser non ha trovato nulla, si precompila con la sede ATTUALE
 * dell'azienda (passata dalla page): meglio proporre il dato che già
 * conosciamo che un form completamente vuoto.
 */
function mapSedeLegale(sedeLegale: SedeLegalePreview | null, sedeAttuale: SedeForm | null): SedeForm {
  if (sedeLegale) {
    return {
      indirizzo: sedeLegale.indirizzo ?? '',
      civico: '',
      cap: sedeLegale.cap ?? '',
      citta: sedeLegale.comune ?? '',
      provincia: sedeLegale.provincia ?? '',
    };
  }
  return sedeAttuale ?? SEDE_VUOTA;
}

type Props = {
  /** Solo il titolare dell'account può aggiornare la visura camerale. */
  isOwner: boolean;
  companyType: 'DEALER' | 'AGENZIA';
  stato: 'OK' | 'PREAVVISO' | 'SCADUTA' | 'ESENTE';
  giorniTrascorsi: number | null;
  giorniRimanenti: number | null;
  /** Sede legale attuale dell'azienda: fallback di precompilazione, solo per il titolare. */
  sedeAttuale: SedeForm | null;
};

export function VisuraClient({
  isOwner,
  companyType,
  stato,
  giorniTrascorsi,
  giorniRimanenti,
  sedeAttuale,
}: Props) {
  const router = useRouter();
  const [step, setStep] = useState<'upload' | 'conferma'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [ref, setRef] = useState<BlobRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [atecoNonIdoneo, setAtecoNonIdoneo] = useState(false);
  const [dataEmissione, setDataEmissione] = useState<string | null>(null);
  const [sede, setSede] = useState<SedeForm>(SEDE_VUOTA);
  const [sedeLegaleMancante, setSedeLegaleMancante] = useState(false);
  const [verificaPending, startVerifica] = useTransition();
  const [confermaPending, startConferma] = useTransition();
  const pending = verificaPending || confermaPending;

  const conseguenza =
    companyType === 'AGENZIA'
      ? 'non puoi gestire pratiche, non ne ricevi di nuove e non puoi prelevare dal wallet'
      : 'non puoi prelevare il saldo del tuo wallet';

  const errors = zodFieldErrors(sedeLegaleSchema, sede);
  const { field, gatedSubmit } = useFieldErrorsState(errors);
  const fIndirizzo = field('indirizzo');
  const fCivico = field('civico');
  const fCap = field('cap');
  const fCitta = field('citta');
  const fProvincia = field('provincia');

  const onFile = async (f: File | null): Promise<void> => {
    setError(null);
    setFile(f);
    setRef(null);
    if (!f) return;
    try {
      setRef(await uploadToBlob(f, 'visura'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Caricamento non riuscito');
    }
  };

  const onVerifica = (): void => {
    if (!ref) {
      setError('Carica prima la visura camerale in PDF');
      return;
    }
    setError(null);
    startVerifica(async () => {
      const fd = new FormData();
      fd.set('blobRef', JSON.stringify(ref));
      const r = await verificaVisuraAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDataEmissione(r.dataEmissione);
      setSedeLegaleMancante(!r.sedeLegale);
      setSede(mapSedeLegale(r.sedeLegale, sedeAttuale));
      setStep('conferma');
    });
  };

  const handleBack = (): void => {
    setStep('upload');
    setFile(null);
    setRef(null);
    setError(null);
    setSede(SEDE_VUOTA);
  };

  const onConferma = (): void => {
    if (!ref) return;
    setError(null);
    startConferma(async () => {
      const fd = new FormData();
      fd.set('blobRef', JSON.stringify(ref));
      fd.set('indirizzo', sede.indirizzo);
      fd.set('civico', sede.civico);
      fd.set('cap', sede.cap);
      fd.set('citta', sede.citta);
      fd.set('provincia', sede.provincia);
      const r = await aggiornaVisuraAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOk(true);
      setAtecoNonIdoneo(r.atecoNonIdoneo);
      router.refresh();
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-6">
      <h1 className="text-xl font-bold text-pv-navy-900">Visura camerale</h1>
      <p className="mt-1 text-sm text-pv-navy-700">
        La visura camerale ci serve per fatturarti correttamente. Vale{' '}
        {VISURA_VALIDITA_GIORNI} giorni dalla data di emissione.
      </p>

      {stato === 'SCADUTA' && (
        <Alert variant="error" title="Visura scaduta — operazioni bloccate" className="mt-5">
          La tua visura è stata emessa {giorniTrascorsi} giorni fa e ha superato i{' '}
          {VISURA_VALIDITA_GIORNI} giorni di validità. Finché non ne carichi una aggiornata,{' '}
          {conseguenza}. Lo sblocco è immediato appena il documento viene accettato.
        </Alert>
      )}
      {stato === 'PREAVVISO' && (
        <Alert variant="warning" title="La visura sta per scadere" className="mt-5">
          Mancano {giorniRimanenti} giorni. Alla scadenza {conseguenza}: aggiornala ora per non
          interrompere l&apos;operatività.
        </Alert>
      )}
      {stato === 'OK' && (
        <Alert variant="success" className="mt-5">
          La tua visura è valida: emessa {giorniTrascorsi} giorni fa, ne restano {giorniRimanenti}.
        </Alert>
      )}
      {stato === 'ESENTE' && (
        <Alert variant="info" className="mt-5">
          Non risulta una data di emissione per la tua visura camerale. Puoi caricarne una
          aggiornata quando vuoi.
        </Alert>
      )}

      {ok && (
        <>
          <Alert variant="success" title="Visura aggiornata" className="mt-5">
            Grazie: il documento è stato accettato e le operazioni sono di nuovo attive.
          </Alert>
          {atecoNonIdoneo && (
            <Alert variant="warning" className="mt-3">
              Il codice ATECO risultante dalla visura non è tra quelli ammessi per la tua
              tipologia di azienda: la visura è comunque stata accettata, ma il nostro team ti
              contatterà per una verifica.
            </Alert>
          )}
        </>
      )}

      {!isOwner ? (
        <Alert variant="info" className="mt-6">
          Solo il titolare dell&apos;account può aggiornare la visura camerale. Contattalo per
          procedere.
        </Alert>
      ) : ok ? null : step === 'upload' ? (
        <div className="mt-6">
          <div className={verificaPending ? 'pointer-events-none opacity-60' : undefined}>
            <DocCard label="Visura camerale (PDF)" pdfOnly file={file} onChange={onFile} />
          </div>
          {error && (
            <Alert variant="error" className="mt-4">
              {error}
            </Alert>
          )}
          <Button
            type="button"
            className="mt-4"
            onClick={onVerifica}
            loading={verificaPending}
            loadingLabel="Verifica in corso…"
            disabled={!ref}
          >
            Verifica documento
          </Button>
        </div>
      ) : (
        <div className="mt-6">
          {dataEmissione && (
            <p className="text-[13px] text-pv-slate-600">
              Visura emessa il <strong>{formatDataEmissione(dataEmissione)}</strong>.
            </p>
          )}

          {sedeLegaleMancante && (
            <Alert variant="warning" className="mt-3">
              Non siamo riusciti a leggere la sede legale dalla visura: inseriscila tu.
            </Alert>
          )}

          <form onSubmit={gatedSubmit(onConferma)} noValidate className="mt-4 space-y-3">
            <Field label="Indirizzo" required error={fIndirizzo.error}>
              <Input
                name="indirizzo"
                value={sede.indirizzo}
                onChange={(e) => setSede((s) => ({ ...s, indirizzo: e.target.value }))}
                onBlur={fIndirizzo.onBlur}
                invalid={fIndirizzo.invalid}
                disabled={confermaPending}
              />
            </Field>
            <Field label="Civico" required error={fCivico.error}>
              <Input
                name="civico"
                value={sede.civico}
                onChange={(e) => setSede((s) => ({ ...s, civico: e.target.value }))}
                onBlur={fCivico.onBlur}
                invalid={fCivico.invalid}
                disabled={confermaPending}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="CAP" required error={fCap.error}>
                <Input
                  name="cap"
                  value={sede.cap}
                  onChange={(e) => setSede((s) => ({ ...s, cap: e.target.value }))}
                  onBlur={fCap.onBlur}
                  invalid={fCap.invalid}
                  maxLength={5}
                  disabled={confermaPending}
                />
              </Field>
              <Field label="Provincia" required error={fProvincia.error}>
                <Input
                  name="provincia"
                  value={sede.provincia}
                  onChange={(e) => setSede((s) => ({ ...s, provincia: e.target.value.toUpperCase() }))}
                  onBlur={fProvincia.onBlur}
                  invalid={fProvincia.invalid}
                  maxLength={2}
                  disabled={confermaPending}
                />
              </Field>
            </div>
            <Field label="Città" required error={fCitta.error}>
              <Input
                name="citta"
                value={sede.citta}
                onChange={(e) => setSede((s) => ({ ...s, citta: e.target.value }))}
                onBlur={fCitta.onBlur}
                invalid={fCitta.invalid}
                disabled={confermaPending}
              />
            </Field>

            {error && (
              <Alert variant="error" className="mt-2">
                {error}
              </Alert>
            )}

            <div className="flex gap-3 pt-1">
              <Button type="submit" loading={confermaPending} loadingLabel="Conferma in corso…">
                Conferma e aggiorna visura
              </Button>
              <Button type="button" variant="secondary" onClick={handleBack} disabled={confermaPending}>
                Carica un altro documento
              </Button>
            </div>
          </form>
        </div>
      )}

      <LoadingOverlay show={pending} label="Stiamo verificando la visura…" />
    </div>
  );
}
