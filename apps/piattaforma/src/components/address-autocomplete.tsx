'use client';

import { useEffect, useRef } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';

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
};

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

let placesPromise: Promise<google.maps.PlacesLibrary> | null = null;
function loadPlaces(): Promise<google.maps.PlacesLibrary> | null {
  if (!API_KEY) return null;
  if (!placesPromise) {
    setOptions({ key: API_KEY, v: 'weekly' });
    placesPromise = importLibrary('places');
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
  // Fallback comune se manca "locality" (alcuni comuni usano postal_town / livello 3)
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
 * Campo di ricerca indirizzo con Google Places Autocomplete (Places API New),
 * ristretto all'Italia. Alla selezione compila i campi indirizzo via `onSelect`.
 * Se la chiave API non è configurata, non renderizza nulla (i campi manuali
 * restano comunque utilizzabili).
 */
export function AddressAutocomplete({
  onSelect,
  label = 'Cerca indirizzo',
}: {
  onSelect: (parts: AddressParts) => void;
  label?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Ref sempre aggiornata, così l'elemento Google viene creato una sola volta.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const places = loadPlaces();
    if (!places) return;
    let element: google.maps.places.PlaceAutocompleteElement | null = null;
    let cancelled = false;

    void places
      .then((lib) => {
        if (cancelled || !containerRef.current) return;
        element = new lib.PlaceAutocompleteElement({ includedRegionCodes: ['it'] });
        element.style.width = '100%';
        containerRef.current.appendChild(element);
        element.addEventListener('gmp-select', (event: Event) => {
          const { placePrediction } = event as unknown as {
            placePrediction: google.maps.places.PlacePrediction;
          };
          void (async () => {
            const place = placePrediction.toPlace();
            await place.fetchFields({ fields: ['addressComponents'] });
            onSelectRef.current(parseComponents(place.addressComponents ?? undefined));
          })();
        });
      })
      .catch(() => {
        /* chiave non valida / API non abilitata: degrada silenziosamente */
      });

    return () => {
      cancelled = true;
      if (element?.parentNode) element.parentNode.removeChild(element);
    };
  }, []);

  if (!API_KEY) return null;

  return (
    <div className="space-y-1.5">
      <label className="block text-[13px] font-semibold text-pv-slate-700">{label}</label>
      <div ref={containerRef} className="pv-places" />
      <p className="text-[12px] text-pv-slate-500">
        Inizia a digitare e seleziona dall&apos;elenco: compiliamo noi i campi sotto.
      </p>
    </div>
  );
}
