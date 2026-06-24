import { getSessionContext } from '@/lib/auth/session-context';
import { SEDE_ALL } from '@/lib/sedi/scope';
import { SedeSwitcherClient } from './sede-switcher-client';

/**
 * Barra selettore sede (server). Visibile solo quando l'utente ha più di una
 * sede accessibile (multi-sede); per il caso 1:1 non compare → UX invariata.
 */
export async function SedeSwitcher() {
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
