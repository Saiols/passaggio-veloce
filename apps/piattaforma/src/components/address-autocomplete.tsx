'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui';

export type AddressParts = {
  /** Via/piazza (route) */
  indirizzo: string;
  /** Numero civico (street_number) */
  civico: string;
  /** Comune (locality / postal_town / admin_area_3) */
  citta: string;
  /** CAP (postal_code) */
  cap: string;
  /** Sigla provincia (admin_area_2 short, es. "RM") */
  provincia: string;
  /** Latitudine (Google Places location), se disponibile. */
  lat?: number;
  /** Longitudine (Google Places location), se disponibile. */
  lng?: number;
};

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

let placesPromise: Promise<google.maps.PlacesLibrary> | null = null;
function loadPlaces(): Promise<google.maps.PlacesLibrary> | null {
  if (!API_KEY) return null;
  if (!placesPromise) {
    // Import dinamico: @googlemaps/js-api-loader tocca `window` a livello di
    // modulo, quindi NON va valutato in SSR (causava 500 sul caricamento
    // diretto/refresh di /pratiche/nuova e /register). Caricato solo qui, lato
    // client (loadPlaces gira dentro useEffect).
    placesPromise = import('@googlemaps/js-api-loader').then(({ setOptions, importLibrary }) => {
      setOptions({ key: API_KEY!, v: 'weekly' });
      return importLibrary('places') as Promise<google.maps.PlacesLibrary>;
    });
  }
  return placesPromise;
}

function parseComponents(
  components: google.maps.places.AddressComponent[] | undefined,
): AddressParts {
  const out: AddressParts = { indirizzo: '', civico: '', citta: '', cap: '', provincia: '' };
  for (const c of components ?? []) {
    const t = c.types;
    if (t.includes('route')) out.indirizzo = c.longText ?? '';
    else if (t.includes('street_number')) out.civico = c.longText ?? '';
    else if (t.includes('postal_code')) out.cap = c.longText ?? '';
    else if (t.includes('locality')) out.citta = c.longText ?? '';
    else if (t.includes('administrative_area_level_2'))
      out.provincia = (c.shortText ?? '').toUpperCase();
  }
  if (!out.citta) {
    for (const c of components ?? []) {
      if (c.types.includes('postal_town') || c.types.includes('administrative_area_level_3')) {
        out.citta = c.longText ?? '';
        break;
      }
    }
  }
  return out;
}

/**
 * Ricerca indirizzo con Google Places (Places API New, Data API) e UI custom:
 * usa il nostro <Input> (icona ricerca a sinistra + X per pulire a destra) e un
 * dropdown stilizzato col design system. Alla selezione compila i campi via
 * `onSelect`. Se la chiave API non è configurata non renderizza nulla.
 */
export function AddressAutocomplete({
  onSelect,
  label = 'Cerca indirizzo',
  placeholder = 'Via, civico, città…',
  helpText = "Inizia a digitare e seleziona dall'elenco: compiliamo noi i campi sotto.",
}: {
  onSelect: (parts: AddressParts) => void;
  label?: string;
  placeholder?: string;
  helpText?: string;
}) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<google.maps.places.PlacePrediction[]>([]);
  const [open, setOpen] = useState(false);

  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const placesRef = useRef<google.maps.PlacesLibrary | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Alla selezione impostiamo `query` col testo dell'indirizzo scelto: questo
  // flag fa saltare la ricerca conseguente, altrimenti l'effetto su [query]
  // rifarebbe l'autocomplete e riaprirebbe il dropdown su ciò che hai appena scelto.
  const skipNextSearchRef = useRef(false);

  // Carica la libreria places una volta.
  useEffect(() => {
    const p = loadPlaces();
    if (!p) return;
    let active = true;
    void p.then((lib) => {
      if (active) placesRef.current = lib;
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Fetch suggerimenti (debounced). Lo setState è nel callback async del timeout,
  // non sincrono nel corpo dell'effect.
  useEffect(() => {
    if (skipNextSearchRef.current) {
      // query impostata da una selezione: nessuna nuova ricerca, dropdown resta chiuso.
      skipNextSearchRef.current = false;
      return;
    }
    const id = window.setTimeout(async () => {
      const q = query.trim();
      const lib = placesRef.current;
      if (q.length < 3 || !lib) {
        setSuggestions([]);
        setOpen(false);
        return;
      }
      if (!sessionTokenRef.current) {
        sessionTokenRef.current = new lib.AutocompleteSessionToken();
      }
      try {
        const { suggestions: res } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: q,
          includedRegionCodes: ['it'],
          sessionToken: sessionTokenRef.current,
        });
        const preds = res
          .map((s) => s.placePrediction)
          .filter((p): p is google.maps.places.PlacePrediction => p !== null);
        setSuggestions(preds);
        setOpen(preds.length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [query]);

  // Chiudi il dropdown al click fuori.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const handleSelect = async (pred: google.maps.places.PlacePrediction) => {
    skipNextSearchRef.current = true;
    setQuery(pred.text?.toString() ?? '');
    setSuggestions([]);
    setOpen(false);
    try {
      const place = pred.toPlace();
      await place.fetchFields({ fields: ['addressComponents', 'location'] });
      const parts = parseComponents(place.addressComponents ?? undefined);
      const loc = place.location;
      onSelectRef.current({
        ...parts,
        lat: typeof loc?.lat === 'function' ? loc.lat() : undefined,
        lng: typeof loc?.lng === 'function' ? loc.lng() : undefined,
      });
    } catch {
      /* ignora: l'utente può compilare i campi a mano */
    }
    // La sessione si conclude alla selezione: nuovo token per la prossima ricerca.
    sessionTokenRef.current = null;
  };

  const clear = () => {
    setQuery('');
    setSuggestions([]);
    setOpen(false);
  };

  if (!API_KEY) return null;

  return (
    <div className="space-y-1.5">
      <label className="block text-[13px] font-semibold text-pv-slate-700">{label}</label>
      <div ref={wrapperRef} className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-pv-slate-500">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
        <Input
          type="text"
          autoComplete="off"
          placeholder={placeholder}
          className="pl-10 pr-9"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        {query && (
          <button
            type="button"
            onClick={clear}
            aria-label="Cancella ricerca"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-pv-slate-500 hover:text-pv-slate-700"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6 6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}

        {open && suggestions.length > 0 && (
          <ul className="absolute z-20 mt-1.5 max-h-72 w-full overflow-auto rounded-[10px] border border-pv-slate-200 bg-white py-1 shadow-lg">
            {suggestions.map((p) => (
              <li key={p.placeId}>
                <button
                  type="button"
                  onClick={() => void handleSelect(p)}
                  className="flex w-full flex-col items-start gap-0.5 px-3.5 py-2 text-left hover:bg-pv-navy-100"
                >
                  <span className="text-[13.5px] font-medium text-pv-slate-900">
                    {p.mainText?.text ?? p.text?.toString() ?? ''}
                  </span>
                  {p.secondaryText?.text && (
                    <span className="text-[12px] text-pv-slate-500">{p.secondaryText.text}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {helpText && <p className="text-[12px] text-pv-slate-500">{helpText}</p>}
    </div>
  );
}
