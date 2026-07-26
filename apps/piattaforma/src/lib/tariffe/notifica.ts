import 'server-only';
import { prisma } from '@pv/db';
import { sendNotification } from '@/lib/notifiche';
import { formatCurrencyCent } from '@/lib/format';
import { env } from '@/env';
import { ETICHETTE_VOCI, formatScostamentoBp, type Variazione } from './variazione';

/**
 * Clausola 3: la comunicazione della variazione tariffaria a TUTTI gli Utenti.
 *
 * È da questa email che decorre il preavviso contrattuale, quindi non è una
 * notifica di cortesia: se non parte, la variazione non è opponibile. Per lo
 * stesso motivo non passa dalle preferenze notifiche (N54 non è fra le
 * opzionali) e va sia ai broker sia alle agenzie — il tariffario tocca la fee
 * dell'agenzia, il compenso del broker e la commissione di affiliazione, che
 * riguardano entrambe le categorie.
 *
 * Destinatario: l'ADMIN_AZIENDA di ciascuna azienda, letto dal DB. Mai
 * `Company.email`, che è il recapito amministrativo e non quello con cui si
 * accede — v. la regola già adottata dalle altre notifiche aziendali.
 */
export async function notificaVariazioneTariffe(input: {
  variazione: Variazione;
  efficaceDal: Date;
}): Promise<{ destinatari: number }> {
  const { variazione, efficaceDal } = input;

  const voci = variazione.voci.map((v) => ({
    etichetta: ETICHETTE_VOCI[v.voce],
    daEuro: formatCurrencyCent(v.daCent),
    aEuro: formatCurrencyCent(v.aCent),
    variazione:
      v.scostamentoBp === null
        ? 'voce introdotta'
        : `${v.scostamentoBp > 0 ? '+' : '−'}${formatScostamentoBp(v.scostamentoBp)}`,
  }));

  const inVigoreDal = efficaceDal.toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Rome',
  });

  // I Termini vivono sull'app, non sul dominio marketing: un link a BRAND.url
  // in un'email rimbalzerebbe sulla landing.
  const terminiUrl = `${env.NEXT_PUBLIC_APP_URL}/termini`;

  const aziende = await prisma.company.findMany({
    where: { deletedAt: null, type: { in: ['DEALER', 'AGENZIA'] } },
    select: {
      id: true,
      ragioneSociale: true,
      users: {
        where: { role: 'ADMIN_AZIENDA', status: 'ACTIVE', deletedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { id: true, email: true, nome: true },
      },
    },
  });

  let destinatari = 0;
  for (const azienda of aziende) {
    const admin = azienda.users[0];
    if (!admin) continue;
    destinatari += 1;
    // Sequenziale e non Promise.all: è un invio massivo verso tutti gli
    // Utenti registrati, e saturare il provider farebbe fallire proprio le
    // comunicazioni da cui dipende l'efficacia della variazione. Ogni invio è
    // già tracciato singolarmente in NotificaInviata.
    await sendNotification({
      tipo: 'N54_VARIAZIONE_TARIFFE',
      target: { email: admin.email, userId: admin.id, companyId: azienda.id },
      payload: {
        nomeDestinatario: admin.nome || azienda.ragioneSociale,
        voci,
        inVigoreDal,
        giorniPreavviso: variazione.giorniPreavviso,
        richiedeRiaccettazione: variazione.richiedeRiaccettazione,
        terminiUrl,
      },
    }).catch(() => undefined);
  }

  return { destinatari };
}
