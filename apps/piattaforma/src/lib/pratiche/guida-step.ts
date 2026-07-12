import type { PraticaStato } from '@/components/ui/status-chip';
import { STATI_IN_ATTESA } from '@/lib/pratiche/stati';

export type StepKey = 'inviata' | 'accettata' | 'processata' | 'firmata';
export type GuidaVariant = 'azione' | 'attesa' | 'chiusa';
export type GuidaCta = 'processata' | 'firma' | 'annulla' | 'valuta' | null;
export type GuidaRuolo = 'DEALER' | 'AGENZIA' | 'ALTRO';

export type GuidaStepItem = {
  key: StepKey;
  label: string;
  stato: 'done' | 'current' | 'todo';
};

export type GuidaStepResult = {
  steps: GuidaStepItem[];
  variant: GuidaVariant;
  titolo: string;
  descrizione: string;
  cta: GuidaCta;
  chiusaNegativa: boolean;
};

const STEP_ORDER: StepKey[] = ['inviata', 'accettata', 'processata', 'firmata'];
const STEP_LABEL: Record<StepKey, string> = {
  inviata: 'Inviata',
  accettata: 'Accettata',
  processata: 'Processata',
  firmata: 'Firmata',
};

function currentIndex(stato: PraticaStato): number {
  if ((STATI_IN_ATTESA as readonly PraticaStato[]).includes(stato) || stato === 'ACCETTATA') return 1;
  if (stato === 'PROCESSATA') return 2;
  if (stato === 'FIRMATA') return 3;
  return 0; // BOZZA, SCADUTA, ANNULLATA
}

function buildSteps(stato: PraticaStato): GuidaStepItem[] {
  const idx = currentIndex(stato);
  const waiting = (STATI_IN_ATTESA as readonly PraticaStato[]).includes(stato);
  const terminalNeg = stato === 'SCADUTA' || stato === 'ANNULLATA';
  const firmata = stato === 'FIRMATA';
  return STEP_ORDER.map((key, i) => {
    let stepStato: GuidaStepItem['stato'];
    if (firmata) stepStato = 'done';
    else if (terminalNeg) stepStato = i === 0 ? 'done' : 'todo';
    else if (i < idx) stepStato = 'done';
    else if (i === idx) stepStato = 'current';
    else stepStato = 'todo';
    const label = waiting && key === 'accettata' ? 'In attesa agenzia' : STEP_LABEL[key];
    return { key, label, stato: stepStato };
  });
}

/** Calcola la guida "prossimo step" (pura, testabile) per stato × ruolo. */
export function guidaStep(input: {
  stato: PraticaStato;
  ruolo: GuidaRuolo;
  hasValutazione: boolean;
}): GuidaStepResult {
  const { stato, ruolo, hasValutazione } = input;
  const steps = buildSteps(stato);
  const base = { steps, chiusaNegativa: false } as const;

  // Stati terminali (uguali per tutti i ruoli)
  if (stato === 'ANNULLATA') {
    return {
      ...base,
      variant: 'chiusa',
      cta: null,
      chiusaNegativa: true,
      titolo: 'Pratica annullata',
      descrizione: 'La pratica è stata annullata e le assegnazioni chiuse.',
    };
  }
  if (stato === 'SCADUTA') {
    return {
      ...base,
      variant: 'chiusa',
      cta: null,
      chiusaNegativa: true,
      titolo: 'Pratica scaduta',
      descrizione: 'Nessuna agenzia ha accettato in tempo.',
    };
  }
  if (stato === 'BOZZA') {
    return {
      ...base,
      variant: 'chiusa',
      cta: null,
      titolo: 'Bozza',
      descrizione: 'Pratica non ancora inviata.',
    };
  }

  const isAgenzia = ruolo === 'AGENZIA';
  const isBroker = ruolo === 'DEALER';

  if (stato === 'FIRMATA') {
    if (isBroker && !hasValutazione) {
      return {
        ...base,
        variant: 'azione',
        cta: 'valuta',
        titolo: 'Valuta l’agenzia',
        descrizione:
          'La pratica è completata: lascia una valutazione all’agenzia qui sotto.',
      };
    }
    return {
      ...base,
      variant: 'chiusa',
      cta: null,
      titolo: 'Pratica completata',
      descrizione: 'Firma avvenuta: la pratica è chiusa.',
    };
  }

  if (stato === 'ACCETTATA') {
    if (isAgenzia) {
      return {
        ...base,
        variant: 'azione',
        cta: 'processata',
        titolo: 'Lavora la pratica',
        descrizione: 'Completa la lavorazione e poi segna “Pratica processata”.',
      };
    }
    return {
      ...base,
      variant: 'attesa',
      cta: null,
      titolo: 'L’agenzia sta lavorando la pratica',
      descrizione: 'Ti avvisiamo appena ci sono aggiornamenti.',
    };
  }

  if (stato === 'PROCESSATA') {
    if (isAgenzia) {
      return {
        ...base,
        variant: 'azione',
        cta: 'firma',
        titolo: 'Segna la firma avvenuta',
        descrizione: 'Conferma quando il cliente ha firmato in agenzia.',
      };
    }
    return {
      ...base,
      variant: 'attesa',
      cta: null,
      titolo: 'In attesa della firma del cliente',
      descrizione: 'L’agenzia ha lavorato la pratica; manca la firma.',
    };
  }

  // WAITING_STATI (IN_ATTESA_*/IN_ESCALATION)
  return {
    ...base,
    variant: 'attesa',
    cta: null,
    titolo: 'In attesa che un’agenzia accetti',
    descrizione:
      'La pratica è stata distribuita alle agenzie della zona. Ti avvisiamo appena una accetta.',
  };
}
