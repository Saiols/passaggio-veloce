import { prisma } from '@pv/db';
import { OPTIONAL_TIPI } from '@/lib/notifiche/preferences';

export const dynamic = 'force-dynamic';

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  let ok = false;
  if (token) {
    const user = await prisma.user.findUnique({
      where: { unsubscribeToken: token },
      select: { id: true, notifPrefs: true },
    });
    if (user) {
      const prefs = (user.notifPrefs as Record<string, boolean> | null) ?? {};
      for (const tipo of OPTIONAL_TIPI) prefs[tipo] = false;
      await prisma.user.update({ where: { id: user.id }, data: { notifPrefs: prefs } });
      ok = true;
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 520, margin: '80px auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 22, color: '#0a2540' }}>
        {ok ? 'Preferenze aggiornate' : 'Link non valido'}
      </h1>
      <p style={{ color: '#334155', fontSize: 14, lineHeight: 1.6 }}>
        {ok
          ? 'Non riceverai più le notifiche facoltative (solleciti, promemoria, recap, inviti a valutare). Le comunicazioni essenziali sulle tue pratiche restano attive. Puoi riattivarle in qualsiasi momento dalla pagina Profilo → Preferenze notifiche.'
          : 'Il link di disiscrizione non è valido o è scaduto. Gestisci le preferenze dalla tua area riservata, in Profilo → Preferenze notifiche.'}
      </p>
    </main>
  );
}
