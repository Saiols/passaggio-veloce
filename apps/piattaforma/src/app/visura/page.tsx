import { redirect } from 'next/navigation';
import { prisma } from '@pv/db';
import { auth } from '@/auth';
import { isOwner } from '@/lib/auth/permissions';
import { getStatoVisura } from '@/lib/visura/stato';
import { VisuraClient } from './client';

export const metadata = { title: 'Visura camerale' };

/**
 * `/visura` è l'UNICA via d'uscita da un blocco per visura scaduta (>= 180
 * giorni): qui il titolare carica una visura aggiornata e si sblocca. Resta
 * comunque accessibile anche quando la visura è OK/PREAVVISO/ESENTE, per
 * poterla rinnovare in anticipo.
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
          select: { indirizzo: true, civico: true, cap: true, citta: true, provincia: true },
        })
      : Promise.resolve(null),
  ]);

  return (
    <VisuraClient
      isOwner={titolare}
      companyType={u.companyType === 'AGENZIA' ? 'AGENZIA' : 'DEALER'}
      stato={stato.stato}
      giorniTrascorsi={stato.giorniTrascorsi}
      giorniRimanenti={stato.giorniRimanenti}
      sedeAttuale={
        azienda
          ? {
              indirizzo: azienda.indirizzo,
              civico: azienda.civico ?? '',
              cap: azienda.cap,
              citta: azienda.citta,
              provincia: azienda.provincia,
            }
          : null
      }
    />
  );
}
