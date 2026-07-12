'use client';

import { useState } from 'react';
import { Checkbox } from '@/components/ui';
import { catalogoPerTipo, type CompanyTypeP, type Permesso } from '@/lib/auth/permessi/catalogo';
import { riconoscePreset, PRESET_ETICHETTE, PRESET_IDS } from '@/lib/auth/permessi/preset';
import { applicaPreset, permessiConcedibili, toggle, toggleCategoria } from './matrice-logic';

/**
 * Matrice a accordion: una categoria per riga, contatore visibile da chiusa.
 * Nessuna logica qui dentro: la cascata delle dipendenze vive in `matrice-logic.ts`,
 * dove si testa senza DOM.
 */
export function MatricePermessi({
  companyType,
  ruoloSede,
  value,
  onChange,
  assegnabili,
}: {
  companyType: CompanyTypeP;
  /** Un OPERATORE non può gestire il team: le caselle `team.*` restano disabilitate. */
  ruoloSede: 'ADMIN_SEDE' | 'OPERATORE';
  value: Permesso[];
  onChange: (v: Permesso[]) => void;
  /** Ciò che il chiamante può concedere: il resto appare disabilitato. */
  assegnabili: Permesso[];
}) {
  const categorie = catalogoPerTipo(companyType);
  const [aperte, setAperte] = useState<Set<string>>(new Set());
  const attivo = new Set(value);
  const puoi = permessiConcedibili(assegnabili, ruoloSede);
  const presetCorrente = riconoscePreset(value, companyType);
  const teamBloccato = ruoloSede === 'OPERATORE';

  return (
    <fieldset className="rounded-xl border border-pv-slate-200 p-4">
      <legend className="px-2 text-sm font-semibold text-pv-navy-700">Permessi</legend>
      <p className="mb-3 text-xs text-pv-slate-500">
        Apri una categoria per scegliere i singoli permessi: il contatore a destra
        (es. <span className="font-medium">3/5 attivi</span>) dice quanti ne sono
        accesi sul totale della categoria. I permessi in grassetto sono azioni
        sensibili: hanno un effetto finanziario o irreversibile (vedi la nota a
        fianco di ciascuno).
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PRESET_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(applicaPreset(id, companyType, puoi))}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              presetCorrente === id
                ? 'border-pv-navy-700 bg-pv-navy-700 text-white'
                : 'border-pv-slate-300 text-pv-slate-700 hover:border-pv-navy-700'
            }`}
          >
            {PRESET_ETICHETTE[id]}
          </button>
        ))}
        {presetCorrente === null && (
          <span className="text-xs text-pv-slate-500">Personalizzato · {value.length} permessi</span>
        )}
      </div>

      <div className="space-y-1">
        {categorie.map((cat) => {
          const chiavi = cat.permessi.map((p) => p.chiave);
          const n = chiavi.filter((p) => attivo.has(p)).length;
          const aperta = aperte.has(cat.id);
          return (
            <div key={cat.id} className="rounded-lg border border-pv-slate-200">
              <div className="flex items-center gap-2 px-3 py-2">
                <Checkbox
                  aria-label={`Tutti i permessi ${cat.etichetta}`}
                  checked={n === chiavi.length && n > 0}
                  ref={(el) => {
                    if (el) el.indeterminate = n > 0 && n < chiavi.length;
                  }}
                  onChange={() => onChange(toggleCategoria(value, cat.id, companyType, puoi))}
                />
                <button
                  type="button"
                  onClick={() =>
                    setAperte((s) => {
                      const next = new Set(s);
                      if (next.has(cat.id)) next.delete(cat.id);
                      else next.add(cat.id);
                      return next;
                    })
                  }
                  className="flex flex-1 items-center justify-between text-left text-sm font-medium text-pv-navy-700"
                  aria-expanded={aperta}
                >
                  <span>{cat.etichetta}</span>
                  <span
                    className="text-xs text-pv-slate-500"
                    title={`${n} permessi attivi su ${chiavi.length} in questa categoria`}
                  >
                    {n}/{chiavi.length} attivi
                  </span>
                </button>
              </div>

              {aperta && (
                <div className="space-y-2 border-t border-pv-slate-200 px-3 py-2 pl-9">
                  {cat.id === 'team' && teamBloccato && (
                    <p className="text-xs text-pv-slate-500">
                      I permessi Team richiedono il ruolo Admin di sede.
                    </p>
                  )}
                  {cat.permessi.map((p) => (
                    <label key={p.chiave} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        aria-label={p.etichetta}
                        checked={attivo.has(p.chiave)}
                        disabled={!puoi.has(p.chiave)}
                        onChange={() => onChange(toggle(value, p.chiave, puoi))}
                        className="mt-0.5"
                      />
                      <span className="flex-1">
                        <span className={p.sensibile ? 'font-semibold text-pv-navy-700' : ''}>
                          {p.etichetta}
                        </span>
                        {p.nota && <span className="ml-2 text-xs text-pv-slate-500">{p.nota}</span>}
                        {!puoi.has(p.chiave) && (
                          <span className="ml-2 text-xs text-pv-slate-400">
                            Non puoi concedere un permesso che non hai
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
