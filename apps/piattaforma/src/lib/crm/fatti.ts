export type CodiceFattuale = 'S0' | 'S1' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9' | 'S10';

export interface ContattoFatti {
  status: string;
  createdAt: Date;
  lastContactAt: Date | null;
  linkInviato: boolean;
  linkInviatoAt: Date | null;
  linkAperto: boolean;
  linkApertoAt: Date | null;
  mailApertaAt: Date | null;
  iscrizioneInit: boolean;
  iscrizioneInitAt: Date | null;
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
  S1: 'Non risponde',
  S4: 'Email inviata',
  S5: 'Link aperto',
  S6: 'Iscrizione incompleta',
  S7: 'Registrato',
  S8: 'Prima pratica',
  S9: 'Attivo',
  S10: 'Churned',
};

/** Posizione nel funnel fattuale (crescente). S2/S3/S11 non ci sono: non sono fatti. */
const RANK: Record<CodiceFattuale, number> = {
  S0: 0,
  S1: 1,
  S4: 2,
  S5: 3,
  S6: 4,
  S7: 5,
  S8: 6,
  S9: 7,
  S10: 8,
};

/**
 * Stato fattuale mostrato in lista: il traguardo PIÙ AVANZATO fra ciò che dicono
 * i FLAG oggettivi e il campo `status` (impostato a mano o dall'automazione).
 *
 * Così uno stato senza flag corrispondente ("Non risponde" S1, "Churned" S10,
 * o un avanzamento manuale) compare comunque; e un flag più avanzato dello
 * status (es. link aperto mentre status è indietro) non viene mai nascosto.
 */
export function statoFattuale(c: ContattoFatti): {
  codice: CodiceFattuale;
  label: string;
  at: Date | null;
} {
  // Traguardo implicito dai flag.
  let flag: CodiceFattuale;
  let flagAt: Date | null;
  if (c.primaPratica && c.praticheTotal >= 2) {
    flag = 'S9';
    flagAt = c.primaPraticaAt;
  } else if (c.primaPratica) {
    flag = 'S8';
    flagAt = c.primaPraticaAt;
  } else if (c.iscrizioneComp) {
    flag = 'S7';
    flagAt = c.iscrizioneAt;
  } else if (c.iscrizioneInit) {
    flag = 'S6';
    flagAt = c.iscrizioneInitAt;
  } else if (c.linkAperto) {
    flag = 'S5';
    flagAt = c.linkApertoAt;
  } else if (c.linkInviato) {
    flag = 'S4';
    flagAt = c.linkInviatoAt;
  } else {
    flag = 'S0';
    flagAt = c.createdAt;
  }

  // Lo `status` conta solo se è un codice fattuale noto (S2/S3/S11 legacy esclusi).
  const statusCode = c.status in RANK ? (c.status as CodiceFattuale) : null;

  if (statusCode && RANK[statusCode] > RANK[flag]) {
    return {
      codice: statusCode,
      label: LABEL_FATTUALE[statusCode],
      at: c.lastContactAt ?? c.createdAt,
    };
  }
  return { codice: flag, label: LABEL_FATTUALE[flag], at: flagAt };
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
  push('mail-aperta', 'Mail aperta', c.mailApertaAt);
  push('iscrizione-init', 'Iscrizione iniziata', c.iscrizioneInitAt);
  push('iscrizione', 'Registrazione completata', c.iscrizioneAt);
  push('pratica', 'Prima pratica', c.primaPraticaAt);
  push('match', 'Agganciato ad azienda', c.matchedAt);
  for (const call of calls) {
    push('chiamata', `Chiamata${call.esito ? `: ${call.esito}` : ''}`, call.startedAt);
  }
  return eventi.sort((a, b) => a.at.getTime() - b.at.getTime());
}
