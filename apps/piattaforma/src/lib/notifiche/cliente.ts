import 'server-only';
import { prisma } from '@pv/db';
import { sendNotification } from './send';
import { buildClienteRecipients, veicoloDescrizione } from './cliente-recipients';
import type { ClienteAvanzamentoStato } from './templates';

/**
 * Invia le email generiche di avanzamento pratica ad acquirente e venditori.
 * Carica la pratica, costruisce/deduplica i destinatari, invia una N40 per
 * ciascuno. Best-effort: nessun errore viene propagato al chiamante (un guasto
 * email non deve mai bloccare la transizione di stato).
 */
export async function notifyClientiAvanzamento(
  praticaId: string,
  stato: ClienteAvanzamentoStato,
): Promise<void> {
  try {
    const pratica = await prisma.pratica.findUnique({
      where: { id: praticaId },
      select: {
        codicePratica: true,
        acquirenteEmail: true,
        acquirenteNome: true,
        acquirenteCognome: true,
        acquirenteIsPersonaGiuridica: true,
        acquirenteRagioneSociale: true,
        venditori: {
          orderBy: { ordine: 'asc' },
          select: {
            email: true,
            nome: true,
            cognome: true,
            isPersonaGiuridica: true,
            ragioneSociale: true,
          },
        },
        veicoli: { orderBy: { ordine: 'asc' }, select: { targa: true } },
      },
    });
    // Salta bozze senza codice (pratica mai distribuita). Nota: bozze con
    // codicePratica esistono (caso-dubbio); i call-site guardano anche
    // su stato !== 'BOZZA' per non notificare quelle mai inviate.
    if (!pratica?.codicePratica) return;

    const recipients = buildClienteRecipients(pratica);
    if (recipients.length === 0) return;

    const veicolo = veicoloDescrizione(pratica.veicoli);
    const codicePratica = pratica.codicePratica;

    await Promise.all(
      recipients.map((r) =>
        sendNotification({
          tipo: 'N40_CLIENTE_AVANZAMENTO',
          target: { email: r.email },
          payload: {
            codicePratica,
            veicoloDescrizione: veicolo,
            nomeDestinatario: r.nomeDestinatario,
            ruolo: r.ruolo,
            stato,
          },
        }).catch(() => undefined),
      ),
    );
  } catch {
    // best-effort: non blocca il flusso chiamante
  }
}
