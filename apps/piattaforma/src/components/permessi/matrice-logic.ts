import {
  catalogoPerTipo,
  conDipendenze,
  figliDi,
  type CompanyTypeP,
  type Permesso,
} from '@/lib/auth/permessi/catalogo';
import { preset, type PresetId } from '@/lib/auth/permessi/preset';

/**
 * Le dipendenze si risolvono qui per comodità di chi compila il form; il server
 * rifiuta comunque un set incoerente (`validaPermessi`). Questa è UI, non difesa.
 */
export function toggle(
  value: readonly Permesso[],
  chiave: Permesso,
  puoi: ReadonlySet<Permesso>,
): Permesso[] {
  const next = new Set(value);
  if (next.has(chiave)) {
    next.delete(chiave);
    const coda = [...figliDi(chiave)];
    while (coda.length) {
      const figlio = coda.pop()!;
      if (next.delete(figlio)) coda.push(...figliDi(figlio));
    }
  } else {
    const chiusura = conDipendenze([chiave]);
    // Senza un padre concedibile il figlio non è concedibile: non fare nulla.
    if (chiusura.some((p) => !puoi.has(p))) return [...value].sort();
    for (const p of chiusura) next.add(p);
  }
  return [...next].sort();
}

export function toggleCategoria(
  value: readonly Permesso[],
  categoriaId: string,
  companyType: CompanyTypeP,
  puoi: ReadonlySet<Permesso>,
): Permesso[] {
  const cat = catalogoPerTipo(companyType).find((c) => c.id === categoriaId);
  if (!cat) return [...value].sort();

  const chiavi = cat.permessi.map((p) => p.chiave).filter((p) => puoi.has(p));
  const tutteAttive = chiavi.length > 0 && chiavi.every((p) => value.includes(p));

  if (tutteAttive) {
    // Spegnere passando da `toggle` propaga la cascata anche ai figli fuori categoria.
    let out: Permesso[] = [...value];
    for (const p of chiavi) if (out.includes(p)) out = toggle(out, p, puoi);
    return out;
  }

  const next = new Set(value);
  for (const p of chiavi) for (const d of conDipendenze([p])) if (puoi.has(d)) next.add(d);
  return [...next].sort();
}

export function applicaPreset(
  id: PresetId,
  companyType: CompanyTypeP,
  puoi: ReadonlySet<Permesso>,
): Permesso[] {
  return preset(id, companyType)
    .filter((p) => puoi.has(p))
    .sort();
}

/**
 * I permessi realmente concedibili a un utente con questo ruolo di sede.
 *
 * `team.*` non ha effetto su un OPERATORE: `manageableSedi()` (lib/sedi/scope.ts)
 * filtra sul ruolo di sede e per lui ritorna sempre `[]`, quindi le action di team
 * lo bloccano sullo scope anche col permesso in mano. Spuntare quelle caselle
 * sarebbe una promessa non mantenuta.
 */
export function permessiConcedibili(
  assegnabili: readonly Permesso[],
  ruoloSede: 'ADMIN_SEDE' | 'OPERATORE',
): Set<Permesso> {
  const out = new Set(assegnabili);
  if (ruoloSede === 'OPERATORE') {
    for (const p of out) if (p.startsWith('team.')) out.delete(p);
  }
  return out;
}
