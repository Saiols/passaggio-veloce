import 'server-only';
import { headers } from 'next/headers';
import { prisma } from '@pv/db';
import { anonymizeIp } from '@/lib/net/ip';

/**
 * Log accessi e attività (art. 32 GDPR). Registra quattro cose e basta:
 * autenticazione, accesso ai documenti, export di dati.
 *
 * ⚠️ NON è "loggare ogni azione". Quel tracciato esiste già, distribuito nei
 * modelli di dominio: `PraticaStatoLog` (chi ha cambiato stato a una pratica,
 * con `attoreUserId`), `NotificaInviata` (ogni email), `BrokerDichiarazione` /
 * `MandatoFatturazione` / `RiaccettazioneTariffa` (gli atti contrattuali, con
 * IP e user-agent). Duplicarlo qui costerebbe una scrittura per richiesta e
 * creerebbe un archivio di dati personali più grande del problema che risolve.
 *
 * L'elenco delle azioni è allineato UNO A UNO con quanto dichiara la privacy
 * policy: allungarlo senza aggiornarla rende falsa l'informativa.
 */

export type AzioneLog =
  | 'LOGIN'
  | 'LOGIN_FALLITO'
  | 'LOGOUT'
  | 'DOCUMENTO_ACCESSO'
  | 'EXPORT_DATI';

export type VoceLog = {
  azione: AzioneLog;
  userId?: string | null;
  email?: string | null;
  companyId?: string | null;
  /** Azienda i cui dati sono stati toccati, se diversa da quella dell'attore. */
  bersaglioCompanyId?: string | null;
  risorsaTipo?: string | null;
  risorsaId?: string | null;
  /** Il tentativo è stato rifiutato (403). È il segnale più utile del log. */
  negato?: boolean;
  dettaglio?: string | null;
};

/**
 * IP e user-agent dalla richiesta corrente. Fuori da un contesto di richiesta
 * `headers()` lancia: qui l'eccezione è assorbita, perché un log senza IP vale
 * comunque più di una richiesta fallita.
 */
async function contestoRichiesta(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    return {
      ip: anonymizeIp(h.get('x-forwarded-for')),
      userAgent: h.get('user-agent'),
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/**
 * Scrive una voce di log. **Non lancia mai** e non va attesa dal chiamante che
 * sta servendo una richiesta: un difetto dell'osservatore non deve mai
 * diventare un difetto della cosa osservata — un download di documento non può
 * fallire perché il log è indisponibile.
 *
 * Il rovescio della medaglia, da sapere: una voce persa non ha alcun sintomo.
 * Per questo il log copre eventi rari e ad alto valore, non il traffico
 * ordinario: su quei pochi, una perdita occasionale è tollerabile.
 */
export async function registraLog(voce: VoceLog): Promise<void> {
  try {
    const { ip, userAgent } = await contestoRichiesta();
    await prisma.logAccesso.create({
      data: {
        azione: voce.azione,
        userId: voce.userId ?? null,
        email: voce.email?.toLowerCase() ?? null,
        companyId: voce.companyId ?? null,
        bersaglioCompanyId: voce.bersaglioCompanyId ?? null,
        risorsaTipo: voce.risorsaTipo ?? null,
        risorsaId: voce.risorsaId ?? null,
        negato: voce.negato ?? false,
        dettaglio: voce.dettaglio ?? null,
        ip,
        userAgent,
      },
    });
  } catch {
    // Volutamente muto: vedi docstring.
  }
}

/**
 * Versione fire-and-forget per i percorsi che non devono attendere la
 * scrittura (download di file, export). `void` esplicito perché la promise
 * non resti unhandled.
 */
export function registraLogAsync(voce: VoceLog): void {
  void registraLog(voce);
}

/** Giorni di conservazione dichiarati nella privacy policy. Fonte unica. */
export const LOG_RETENTION_GIORNI = 730; // 24 mesi
