export type CodiceFattuale = 'S0' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9';

export interface ContattoFatti {
  createdAt: Date;
  linkInviato: boolean;
  linkInviatoAt: Date | null;
  linkAperto: boolean;
  linkApertoAt: Date | null;
  iscrizioneInit: boolean;
  iscrizioneComp: boolean;
  iscrizioneAt: Date | null;
  primaPratica: boolean;
  primaPraticaAt: Date | null;
  praticheTotal: number;
  matchedAt: Date | null;
}

export interface CallFatto {
  startedAt: Date;
  esito: string | null;
}

const LABEL_FATTUALE: Record<CodiceFattuale, string> = {
  S0: 'Non contattato',
  S4: 'Email inviata',
  S5: 'Link aperto',
  S6: 'Iscrizione incompleta',
  S7: 'Registrato',
  S8: 'Prima pratica',
  S9: 'Attivo',
};

/** Traguardo di funnel più avanzato in base ai FLAG (non allo status). */
export function statoFattuale(c: ContattoFatti): {
  codice: CodiceFattuale;
  label: string;
  at: Date | null;
} {
  let codice: CodiceFattuale;
  let at: Date | null;
  if (c.primaPratica && c.praticheTotal >= 2) {
    codice = 'S9';
    at = c.primaPraticaAt;
  } else if (c.primaPratica) {
    codice = 'S8';
    at = c.primaPraticaAt;
  } else if (c.iscrizioneComp) {
    codice = 'S7';
    at = c.iscrizioneAt;
  } else if (c.iscrizioneInit) {
    codice = 'S6';
    at = c.iscrizioneAt;
  } else if (c.linkAperto) {
    codice = 'S5';
    at = c.linkApertoAt;
  } else if (c.linkInviato) {
    codice = 'S4';
    at = c.linkInviatoAt;
  } else {
    codice = 'S0';
    at = c.createdAt;
  }
  return { codice, label: LABEL_FATTUALE[codice], at };
}

/** Storico datato dei fatti: timestamp del contatto + chiamate, ordinato crescente. */
export function timelineFatti(
  c: ContattoFatti,
  calls: CallFatto[],
): Array<{ tipo: string; label: string; at: Date }> {
  const eventi: Array<{ tipo: string; label: string; at: Date }> = [];
  const push = (tipo: string, label: string, at: Date | null) => {
    if (at) eventi.push({ tipo, label, at });
  };
  push('creato', 'Contatto creato', c.createdAt);
  push('email', 'Email inviata', c.linkInviatoAt);
  push('apertura', 'Link aperto', c.linkApertoAt);
  push('iscrizione', 'Registrazione completata', c.iscrizioneAt);
  push('pratica', 'Prima pratica', c.primaPraticaAt);
  push('match', 'Agganciato ad azienda', c.matchedAt);
  for (const call of calls) {
    push('chiamata', `Chiamata${call.esito ? `: ${call.esito}` : ''}`, call.startedAt);
  }
  return eventi.sort((a, b) => a.at.getTime() - b.at.getTime());
}
