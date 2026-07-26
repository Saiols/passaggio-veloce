'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@pv/db';
import { isAdminPiattaforma } from '@/lib/auth/permissions';
import { getRigaTariffaCorrente } from '@/lib/tariffario';
import { DEFAULT_TARIFFARIO, type TariffaRow } from '@/lib/pricing';
import { calcolaVariazione, efficaciaDal } from '@/lib/tariffe/variazione';
import { notificaVariazioneTariffe } from '@/lib/tariffe/notifica';
import { validateTariffaInput, type TariffaFormInput } from './validate';

export type SalvaTariffarioResult =
  | {
      ok: true;
      fascia: 'NESSUNA' | 'LIEVE' | 'RILEVANTE';
      giorniPreavviso: number;
      efficaceDal: string;
      destinatariAvvisati: number;
    }
  | { ok: false; error: string };

/** La tariffa corrente come sei numeri, con i default legacy se non c'è riga. */
function rigaCorrenteToRow(riga: Awaited<ReturnType<typeof getRigaTariffaCorrente>>): TariffaRow {
  if (!riga) {
    return {
      sempliceFeeAgenziaCent: DEFAULT_TARIFFARIO.SEMPLICE.feeAgenziaCent,
      sempliceCreditoBrokerCent: DEFAULT_TARIFFARIO.SEMPLICE.creditoBrokerCent,
      sempliceAffiliazioneCent: DEFAULT_TARIFFARIO.SEMPLICE.affiliazioneCent,
      minivolturaFeeAgenziaCent: DEFAULT_TARIFFARIO.MINIVOLTURA.feeAgenziaCent,
      minivolturaCreditoBrokerCent: DEFAULT_TARIFFARIO.MINIVOLTURA.creditoBrokerCent,
      minivolturaAffiliazioneCent: DEFAULT_TARIFFARIO.MINIVOLTURA.affiliazioneCent,
    };
  }
  return {
    sempliceFeeAgenziaCent: riga.sempliceFeeAgenziaCent,
    sempliceCreditoBrokerCent: riga.sempliceCreditoBrokerCent,
    sempliceAffiliazioneCent: riga.sempliceAffiliazioneCent,
    minivolturaFeeAgenziaCent: riga.minivolturaFeeAgenziaCent,
    minivolturaCreditoBrokerCent: riga.minivolturaCreditoBrokerCent,
    minivolturaAffiliazioneCent: riga.minivolturaAffiliazioneCent,
  };
}

/**
 * Programma una variazione tariffaria ai sensi della clausola 3.
 *
 * Il salvataggio NON cambia più il prezzo all'istante: crea una riga con una
 * data di efficacia futura e comunica la variazione a tutti gli Utenti. Il
 * preavviso lo decide `calcolaVariazione` — 7 giorni fino al 20%, 30 giorni e
 * riaccettazione esplicita oltre — e non è a discrezione di chi salva: l'unica
 * leva manuale è dichiarare la modifica «strutturale», che può solo allungare
 * il preavviso, mai accorciarlo.
 *
 * L'unico caso a efficacia immediata è quello in cui nessun importo cambia (si
 * sta correggendo la nota): lì non c'è nulla da preavvisare e nessuna email da
 * mandare.
 */
export async function salvaTariffarioAction(
  input: TariffaFormInput & { note?: string; strutturale?: boolean },
): Promise<SalvaTariffarioResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return { ok: false, error: 'Solo Admin Piattaforma può modificare le tariffe' };
  }
  const parsed = validateTariffaInput(input);
  if (!parsed.ok) return parsed;

  const now = new Date();
  const corrente = rigaCorrenteToRow(await getRigaTariffaCorrente(now));
  const variazione = calcolaVariazione(corrente, parsed.cents, {
    strutturale: input.strutturale === true,
  });
  const dataEfficacia = efficaciaDal(now, variazione.giorniPreavviso);

  await prisma.$transaction(async (tx) => {
    // Una variazione programmata e non ancora efficace viene sostituita da
    // questa: annullata, non cancellata, perché la sua comunicazione è già
    // partita e l'annullamento va tracciato.
    await tx.tariffaPiattaforma.updateMany({
      where: { efficaceDal: { gt: now }, annullataAt: null },
      data: { annullataAt: now, annullataDaId: session.user.id },
    });
    await tx.tariffaPiattaforma.create({
      data: {
        ...parsed.cents,
        efficaceDal: dataEfficacia,
        richiedeRiaccettazione: variazione.richiedeRiaccettazione,
        scostamentoMassimoBp: variazione.scostamentoMassimoBp,
        strutturale: variazione.strutturale,
        note: input.note?.trim() || null,
        createdById: session.user.id,
      },
    });
  });

  // La comunicazione è ciò da cui decorre il preavviso: se fallisse in
  // silenzio, la variazione entrerebbe in vigore senza che nessuno l'abbia
  // saputa. Non blocca il salvataggio (la riga è già scritta e l'admin può
  // annullarla), ma il conteggio torna al chiamante, che lo mostra.
  let destinatariAvvisati = 0;
  if (variazione.fascia !== 'NESSUNA') {
    const esito = await notificaVariazioneTariffe({
      variazione,
      efficaceDal: dataEfficacia,
    }).catch(() => ({ destinatari: 0 }));
    destinatariAvvisati = esito.destinatari;
  }

  revalidatePath('/admin/tariffe');
  revalidatePath('/affiliazione');
  return {
    ok: true,
    fascia: variazione.fascia,
    giorniPreavviso: variazione.giorniPreavviso,
    efficaceDal: dataEfficacia.toISOString(),
    destinatariAvvisati,
  };
}

export type AnnullaVariazioneResult = { ok: true } | { ok: false; error: string };

/**
 * Annulla una variazione ancora PROGRAMMATA (efficacia futura).
 *
 * Non tocca le tariffe già in vigore: una volta entrata in vigore, una tariffa
 * si cambia solo con un'altra variazione, con il suo preavviso. Annullare a
 * posteriori significherebbe applicare retroattivamente un prezzo diverso da
 * quello comunicato.
 */
export async function annullaVariazioneProgrammataAction(
  tariffaId: string,
): Promise<AnnullaVariazioneResult> {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!isAdminPiattaforma(session.user.role)) {
    return { ok: false, error: 'Solo Admin Piattaforma può annullare una variazione' };
  }

  const now = new Date();
  const esito = await prisma.tariffaPiattaforma.updateMany({
    where: { id: tariffaId, efficaceDal: { gt: now }, annullataAt: null },
    data: { annullataAt: now, annullataDaId: session.user.id },
  });
  if (esito.count === 0) {
    return {
      ok: false,
      error: 'Variazione non annullabile: è già in vigore, o era già stata annullata',
    };
  }

  revalidatePath('/admin/tariffe');
  revalidatePath('/affiliazione');
  return { ok: true };
}
