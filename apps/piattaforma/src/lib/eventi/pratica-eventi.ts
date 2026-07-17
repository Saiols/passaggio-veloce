import { EVENTO, type EventoPraticaInput } from './tipi';

/**
 * Builder PURI degli eventi pratica: dato il minimo indispensabile producono
 * il contenuto della modale (titolo/testo/CTA) e il target. Nessun accesso al
 * DB → testabili in isolamento. L'emissione è in `emit.ts`.
 *
 * Multi-sede: oltre a `targetCompanyId` (azienda madre) ogni builder accetta un
 * `sedeId` opzionale → `targetSedeId`, così il watcher filtra per sede operativa.
 *
 * Convenzione CTA: gli eventi che richiedono un'azione sulla pratica linkano a
 * `/pratiche/{id}` (lato agenzia e broker la scheda è lì); i "nuovi lavori"
 * disponibili linkano all'`/inbox`; gli eventi puramente informativi non hanno CTA.
 */

const apriPratica = (praticaId: string) => ({ ctaLabel: 'Apri la pratica', ctaHref: `/pratiche/${praticaId}` });

/** Broker invia → ogni sede agenzia selezionata vede "nuova pratica disponibile". */
export function eventoNuovaPratica(args: {
  praticaId: string;
  agenziaId: string;
  sedeId?: string | null;
  codicePratica: string;
}): EventoPraticaInput {
  return {
    praticaId: args.praticaId,
    targetCompanyId: args.agenziaId,
    targetSedeId: args.sedeId ?? null,
    tipo: EVENTO.NUOVA_PRATICA,
    titolo: 'Nuova pratica disponibile',
    testo: `È disponibile una nuova pratica (${args.codicePratica}) da accettare: sei tra le agenzie selezionate.`,
    ctaLabel: "Vai all'inbox",
    ctaHref: '/inbox',
  };
}

/** Agenzia accetta → il broker lo vede. */
export function eventoPraticaAccettata(args: {
  praticaId: string;
  brokerId: string;
  sedeId?: string | null;
  codicePratica: string;
  agenziaNome?: string | null;
}): EventoPraticaInput {
  const chi = args.agenziaNome?.trim() ? `${args.agenziaNome.trim()} ha` : "Un'agenzia ha";
  return {
    praticaId: args.praticaId,
    targetCompanyId: args.brokerId,
    targetSedeId: args.sedeId ?? null,
    tipo: EVENTO.PRATICA_ACCETTATA,
    titolo: 'Pratica accettata',
    testo: `${chi} accettato la pratica ${args.codicePratica}.`,
    ...apriPratica(args.praticaId),
  };
}

/** Agenzia segna lavorata → il broker lo vede. */
export function eventoPraticaLavorata(args: {
  praticaId: string;
  brokerId: string;
  sedeId?: string | null;
  codicePratica: string;
}): EventoPraticaInput {
  return {
    praticaId: args.praticaId,
    targetCompanyId: args.brokerId,
    targetSedeId: args.sedeId ?? null,
    tipo: EVENTO.PRATICA_LAVORATA,
    titolo: 'Pratica lavorata',
    testo: `La pratica ${args.codicePratica} è stata lavorata dall'agenzia ed è in attesa di firma.`,
    ...apriPratica(args.praticaId),
  };
}

/** Firma avvenuta → il broker lo vede (credito accreditato). */
export function eventoPraticaFirmata(args: {
  praticaId: string;
  brokerId: string;
  sedeId?: string | null;
  codicePratica: string;
}): EventoPraticaInput {
  return {
    praticaId: args.praticaId,
    targetCompanyId: args.brokerId,
    targetSedeId: args.sedeId ?? null,
    tipo: EVENTO.PRATICA_FIRMATA,
    titolo: 'Firma avvenuta',
    testo: `La pratica ${args.codicePratica} è stata firmata: il credito è stato accreditato sul tuo wallet.`,
    ...apriPratica(args.praticaId),
  };
}

/** Nessuna agenzia disponibile (escalation) → il broker lo vede. */
export function eventoPraticaEscalation(args: {
  praticaId: string;
  brokerId: string;
  sedeId?: string | null;
  codicePratica: string;
}): EventoPraticaInput {
  return {
    praticaId: args.praticaId,
    targetCompanyId: args.brokerId,
    targetSedeId: args.sedeId ?? null,
    tipo: EVENTO.PRATICA_ESCALATION,
    titolo: 'Nessuna agenzia disponibile',
    testo: `Per la pratica ${args.codicePratica} nessuna agenzia ha accettato: la gestiamo manualmente e ti aggiorniamo a breve.`,
    ...apriPratica(args.praticaId),
  };
}

/** Admin assegna una pratica in escalation → la sede agenzia lo vede. */
export function eventoPraticaAssegnata(args: {
  praticaId: string;
  agenziaId: string;
  sedeId?: string | null;
  codicePratica: string;
}): EventoPraticaInput {
  return {
    praticaId: args.praticaId,
    targetCompanyId: args.agenziaId,
    targetSedeId: args.sedeId ?? null,
    tipo: EVENTO.PRATICA_ASSEGNATA,
    titolo: 'Pratica assegnata',
    testo: `Ti è stata assegnata la pratica ${args.codicePratica}: trovi dettagli e documenti nella tua area.`,
    ...apriPratica(args.praticaId),
  };
}

/** Broker annulla una pratica già accettata → la sede agenzia assegnata lo vede. */
export function eventoPraticaAnnullata(args: {
  praticaId: string;
  agenziaId: string;
  sedeId?: string | null;
  codicePratica: string;
}): EventoPraticaInput {
  return {
    praticaId: args.praticaId,
    targetCompanyId: args.agenziaId,
    targetSedeId: args.sedeId ?? null,
    tipo: EVENTO.PRATICA_ANNULLATA,
    titolo: 'Pratica annullata',
    testo: `Il broker ha annullato la pratica ${args.codicePratica}. Non sono richieste altre azioni.`,
    ctaLabel: null,
    ctaHref: null,
  };
}

/** Admin revoca una pratica accettata-non-lavorata → la sede agenzia revocata lo vede. */
export function eventoPraticaRevocata(args: {
  praticaId: string;
  agenziaId: string;
  sedeId?: string | null;
  codicePratica: string;
}): EventoPraticaInput {
  return {
    praticaId: args.praticaId,
    targetCompanyId: args.agenziaId,
    targetSedeId: args.sedeId ?? null,
    tipo: EVENTO.PRATICA_REVOCATA,
    titolo: 'Gestione revocata',
    testo: `La gestione della pratica ${args.codicePratica} è stata revocata perché non risultava lavorata. Non sono richieste altre azioni.`,
    ctaLabel: null,
    ctaHref: null,
  };
}

/** Penale confermata → broker (addebito) e agenzia (segnalazione confermata). */
export function eventoPraticaPenale(args: {
  praticaId: string;
  targetCompanyId: string;
  sedeId?: string | null;
  codicePratica: string;
  ruolo: 'broker' | 'agenzia';
}): EventoPraticaInput {
  const broker = args.ruolo === 'broker';
  return {
    praticaId: args.praticaId,
    targetCompanyId: args.targetCompanyId,
    targetSedeId: args.sedeId ?? null,
    tipo: EVENTO.PRATICA_PENALE,
    titolo: broker ? 'Penale addebitata' : 'Segnalazione confermata',
    testo: broker
      ? `È stata applicata una penale sulla pratica ${args.codicePratica}.`
      : `La tua segnalazione sulla pratica ${args.codicePratica} è stata confermata.`,
    ...apriPratica(args.praticaId),
  };
}
