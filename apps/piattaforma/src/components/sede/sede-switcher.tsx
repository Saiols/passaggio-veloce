import { getSessionContext } from '@/lib/auth/session-context';
import { SEDE_ALL } from '@/lib/sedi/scope';
import { SedeSwitcherClient } from './sede-switcher-client';

/**
 * Sezioni il cui contenuto è effettivamente filtrato per sede: solo qui il
 * selettore ha senso (cambiare sede cambia ciò che vedi). Altrove (es. /sedi,
 * /team, /profilo, /fatturazione) la scelta della sede è irrilevante.
 */
const SEDE_SCOPED_PATHS = [
  '/dashboard',
  '/pratiche',
  '/inbox',
  '/wallet',
  '/orari',
  '/affiliazione',
];

/**
 * Barra selettore sede (server). Compare solo: (a) nelle sezioni scoped per sede
 * e (b) quando l'utente ha più di una sede accessibile (multi-sede). Per il caso
 * 1:1 o nelle pagine non-scoped non compare → UX invariata.
 */
export async function SedeSwitcher({ activePath }: { activePath?: string }) {
  const scoped =
    !!activePath &&
    SEDE_SCOPED_PATHS.some((p) => activePath === p || activePath.startsWith(p + '/'));
  if (!scoped) return null;

  const ctx = await getSessionContext();
  if (!ctx || ctx.accessibleSedi.length <= 1) return null;

  const current = ctx.currentSede?.kind === 'ONE' ? ctx.currentSede.sede.id : SEDE_ALL;

  return (
    <div className="border-b border-pv-slate-200 bg-white px-5 py-2 sm:px-6">
      <div className="mx-auto flex max-w-6xl items-center justify-end">
        <SedeSwitcherClient
          sedi={ctx.accessibleSedi.map((s) => ({ id: s.id, nome: s.nome }))}
          current={current}
          isOwner={ctx.isOwner}
        />
      </div>
    </div>
  );
}
