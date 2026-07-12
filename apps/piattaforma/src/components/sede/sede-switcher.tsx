import { getSessionContext } from '@/lib/auth/session-context';
import { SEDE_ALL } from '@/lib/sedi/scope';
import { etichetteSediUniche } from '@/lib/sedi/etichetta-sede';
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
export async function SedeSwitcher({
  activePath,
  ragioneSociale,
}: {
  activePath?: string;
  /** Ragione sociale dell'azienda: stesso input di `etichettaSede`, per far
   *  concordare l'etichetta del menu con quella della card sidebar. */
  ragioneSociale?: string | null;
}) {
  const scoped =
    !!activePath &&
    SEDE_SCOPED_PATHS.some((p) => activePath === p || activePath.startsWith(p + '/'));
  if (!scoped) return null;

  const ctx = await getSessionContext();
  if (!ctx || ctx.accessibleSedi.length <= 1) return null;

  const current = ctx.currentSede?.kind === 'ONE' ? ctx.currentSede.sede.id : SEDE_ALL;

  // Stessa regola della card (`etichettaSede`/`nomeSedeDistintivo`), non il
  // nome grezzo della sede: altrimenti il menu dice "Dimensione Auto Milano
  // Srls" mentre la card, per la stessa sede, dice "Buccinasco". Se due sedi
  // collidessero sulla stessa etichetta, `etichetteSediUniche` le disambigua:
  // un selettore con due opzioni identiche sarebbe inutilizzabile.
  const etichette = etichetteSediUniche(ctx.accessibleSedi, ragioneSociale);
  const labelById = new Map(etichette.map((e) => [e.id, e.label]));

  return (
    <div className="border-b border-pv-slate-200 bg-white px-5 py-2 sm:px-6">
      <div className="mx-auto flex max-w-6xl items-center justify-end">
        <SedeSwitcherClient
          sedi={ctx.accessibleSedi.map((s) => ({ id: s.id, label: labelById.get(s.id) ?? s.nome }))}
          current={current}
          isOwner={ctx.isOwner}
        />
      </div>
    </div>
  );
}
