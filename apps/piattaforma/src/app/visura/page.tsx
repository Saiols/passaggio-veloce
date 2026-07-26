import { redirect } from 'next/navigation';
import { prisma } from '@pv/db';
import { auth } from '@/auth';
import { isOwner } from '@/lib/auth/permissions';
import { getStatoVisura } from '@/lib/visura/stato';
import { AppShell } from '@/components/app-shell';
import { SuspensionBanner } from '@/components/suspension-banner';
import { VisuraClient } from './client';

export const metadata = { title: 'Visura camerale' };

/**
 * `/visura` è l'UNICA via d'uscita da un blocco per visura scaduta (>= 180
 * giorni): qui il titolare carica una visura aggiornata e si sblocca. È anche
 * la pagina dove si rinnova in anticipo (stato OK/PREAVVISO) o si carica la
 * prima visura (ESENTE, nessuna data nota).
 *
 * Due layout, scelti dallo STATO e non dal ruolo:
 *  - SCADUTA → interstiziale senza chrome, come `/blocco-pagamento`. C'è un
 *    adempimento aperto e la pagina non deve competere con una sidebar piena
 *    di scorciatoie; il banner sospensione va montato a mano (fuori AppShell).
 *  - tutto il resto → dentro la shell del ruolo, via `AppShell`: nessun blocco
 *    in atto, quindi la visura è una voce di Impostazioni come le altre
 *    (`nav-voci.ts`) e si raggiunge/lascia dalla sidebar. Qui il banner
 *    sospensione arriva già da `ChromeBanners`: montarlo di nuovo lo
 *    duplicherebbe.
 *
 * NB: "bloccata" = SCADUTA per entrambi i tipi azienda, anche se la portata
 * del blocco differisce (agenzia: operatività + payout; broker: solo payout,
 * cfr. `VisuraBanner`). PREAVVISO non è un blocco: la scadenza non è arrivata.
 */
export default async function VisuraPage() {
  const session = await auth();
  const u = session?.user;
  if (!u) redirect('/login');
  if (!u.companyId) redirect('/dashboard');

  const titolare = isOwner(u.role);

  const [stato, azienda] = await Promise.all([
    getStatoVisura(u.companyId),
    // La sede attuale alimenta il fallback di precompilazione quando il
    // parser non trova la sede legale (best-effort). È un dato che serve
    // solo a chi può editare il form: a chi non è titolare non lo mandiamo
    // nemmeno nel payload della pagina.
    titolare
      ? prisma.company.findUnique({
          where: { id: u.companyId },
          select: { indirizzo: true, cap: true, citta: true, provincia: true },
        })
      : Promise.resolve(null),
  ]);

  const bloccata = stato.stato === 'SCADUTA';

  const contenuto = (
    <VisuraClient
      isOwner={titolare}
      companyType={u.companyType === 'AGENZIA' ? 'AGENZIA' : 'DEALER'}
      stato={stato.stato}
      giorniTrascorsi={stato.giorniTrascorsi}
      giorniRimanenti={stato.giorniRimanenti}
      // Solo nell'interstiziale: dentro la shell la via di ritorno è la
      // sidebar, e un secondo link alla dashboard sarebbe rumore.
      mostraRitornoDashboard={bloccata}
      sedeAttuale={
        azienda
          ? {
              indirizzo: azienda.indirizzo,
              cap: azienda.cap,
              citta: azienda.citta,
              provincia: azienda.provincia,
            }
          : null
      }
    />
  );

  if (!bloccata) {
    return (
      <AppShell session={session} activePath="/visura">
        {contenuto}
      </AppShell>
    );
  }

  return (
    <>
      {/* Ramo bloccato: fuori da AppShell, quindi il banner sospensione va
          montato qui (come /blocco-pagamento). Serve perché le action della
          visura restano CONSENTITE sotto sospensione — sono un rimedio — e il
          banner è ciò che spiega che il resto invece no. */}
      <div className="mx-auto w-full max-w-2xl px-5 pt-8 empty:hidden sm:px-6">
        <SuspensionBanner />
      </div>
      {contenuto}
    </>
  );
}
