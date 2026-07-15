'use client';

import { useEffect, useRef, useState } from 'react';
import { MarkerClusterer, type Renderer } from '@googlemaps/markerclusterer';
import type { MappaPoint } from '@/lib/crm/mappa-points';
import { pointColor, DEALER_COLOR, AGENZIA_COLOR } from '@/lib/crm/mappa-colors';

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const ITALY_CENTER = { lat: 42.0, lng: 12.5 };

// Nota colori: hex inline (DEALER_COLOR/AGENZIA_COLOR) perché Google Maps
// disegna marker e cluster su canvas/SVG e non accetta classi Tailwind.

function markerIcon(color: string): google.maps.Symbol {
  return {
    // `markerIcon` è invocata solo dopo importLibrary('marker'): `google` è
    // caricato, quindi possiamo usare l'enum reale invece del cast a 0.
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 1.5,
    scale: 6,
  };
}

/**
 * Renderer cluster colorato per tipo, con il conteggio al centro.
 *
 * Usa `google.maps.Marker` (legacy) con un'icona SVG inline invece di
 * `AdvancedMarkerElement`: quest'ultimo richiede un Map ID configurato su
 * Google Cloud per essere disegnato, che qui non abbiamo. I pallini singoli
 * sono già `google.maps.Marker`, quindi l'intera mappa resta sull'API legacy
 * e non dipende da un Map ID.
 */
function clusterRenderer(color: string): Renderer {
  return {
    render: ({ count, position }) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><circle cx="22" cy="22" r="20" fill="${color}" fill-opacity="0.95" stroke="#ffffff" stroke-width="2"/></svg>`;
      return new google.maps.Marker({
        position,
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
          scaledSize: new google.maps.Size(44, 44),
          anchor: new google.maps.Point(22, 22),
        },
        label: {
          text: String(count),
          color: '#ffffff',
          fontSize: '13px',
          fontWeight: '600',
        },
        // Sopra i pallini singoli.
        zIndex: 1000 + count,
      });
    },
  };
}

export function MappaClient({
  points,
  nonGeolocalizzate,
}: {
  points: MappaPoint[];
  nonGeolocalizzate: number;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [showDealer, setShowDealer] = useState(true);
  const [showAgenzia, setShowAgenzia] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const dealerClustererRef = useRef<MarkerClusterer | null>(null);
  const agenziaClustererRef = useRef<MarkerClusterer | null>(null);
  const dealerMarkersRef = useRef<google.maps.Marker[]>([]);
  const agenziaMarkersRef = useRef<google.maps.Marker[]>([]);
  // Ultimo valore dei toggle, letto alla COSTRUZIONE dei clusterer: se l'utente
  // spegne un layer mentre la mappa carica (async), i clusterer nascono già
  // coerenti col toggle invece di mostrare tutto ignorando lo stato.
  const showDealerRef = useRef(showDealer);
  const showAgenziaRef = useRef(showAgenzia);

  const nDealer = points.filter((p) => p.type === 'DEALER').length;
  const nAgenzia = points.filter((p) => p.type === 'AGENZIA').length;

  useEffect(() => {
    if (!API_KEY || !mapRef.current) return;
    let cancelled = false;

    void (async () => {
      try {
        const { setOptions, importLibrary } = await import('@googlemaps/js-api-loader');
        setOptions({ key: API_KEY, v: 'weekly' });
        const { Map, InfoWindow } = (await importLibrary('maps')) as google.maps.MapsLibrary;
        await importLibrary('marker'); // rende disponibile google.maps.Marker
        if (cancelled || !mapRef.current) return;

        const map = new Map(mapRef.current, {
          center: ITALY_CENTER,
          zoom: 6,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        const info = new InfoWindow();

        const makeMarkers = (type: 'DEALER' | 'AGENZIA') =>
          points
            .filter((p) => p.type === type)
            .map((p) => {
              const m = new google.maps.Marker({
                position: { lat: p.lat, lng: p.lng },
                icon: markerIcon(pointColor(type)),
                title: p.nome,
              });
              m.addListener('click', () => {
                // Contenuto costruito come nodo DOM con textContent: nome/città/
                // provincia sono free-text del tenant (nessuno stripping HTML lato
                // schema) → mai interpolati come HTML, altrimenti XSS nella sessione
                // dell'admin che clicca il pin. setContent riceve un Element.
                const el = document.createElement('div');
                el.style.fontSize = '13px';
                const strong = document.createElement('strong');
                strong.textContent = p.nome;
                el.append(
                  strong,
                  document.createElement('br'),
                  document.createTextNode(`${p.citta} (${p.provincia})`),
                  document.createElement('br'),
                  document.createTextNode(type === 'DEALER' ? 'Broker' : 'Agenzia'),
                );
                info.setContent(el);
                info.open(map, m);
              });
              return m;
            });

        dealerMarkersRef.current = makeMarkers('DEALER');
        agenziaMarkersRef.current = makeMarkers('AGENZIA');

        dealerClustererRef.current = new MarkerClusterer({
          map,
          markers: showDealerRef.current ? dealerMarkersRef.current : [],
          renderer: clusterRenderer(DEALER_COLOR),
        });
        agenziaClustererRef.current = new MarkerClusterer({
          map,
          markers: showAgenziaRef.current ? agenziaMarkersRef.current : [],
          renderer: clusterRenderer(AGENZIA_COLOR),
        });
      } catch (err) {
        // Chiave invalida/con restrizioni o libreria non caricata: evita la mappa
        // perennemente vuota senza feedback.
        console.error('[mappa] caricamento Google Maps fallito', err);
        if (!cancelled) setLoadError(true);
      }
    })();

    return () => {
      cancelled = true;
      dealerClustererRef.current?.clearMarkers();
      agenziaClustererRef.current?.clearMarkers();
    };
  }, [points]);

  // Toggle layer: aggiungi/rimuovi i marker dal rispettivo clusterer. La ref è
  // aggiornata PRIMA dell'early-return così, se il clusterer non esiste ancora
  // (mappa in caricamento), la costruzione successiva legge lo stato corretto.
  useEffect(() => {
    showDealerRef.current = showDealer;
    const c = dealerClustererRef.current;
    if (!c) return;
    c.clearMarkers();
    if (showDealer) c.addMarkers(dealerMarkersRef.current);
  }, [showDealer]);

  useEffect(() => {
    showAgenziaRef.current = showAgenzia;
    const c = agenziaClustererRef.current;
    if (!c) return;
    c.clearMarkers();
    if (showAgenzia) c.addMarkers(agenziaMarkersRef.current);
  }, [showAgenzia]);

  if (!API_KEY) {
    return (
      <div className="rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 p-6 text-[13px] text-pv-slate-500">
        Mappa non disponibile: manca la chiave Google Maps.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowDealer((v) => !v)}
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium ${showDealer ? 'border-pv-slate-300 text-pv-slate-900' : 'border-pv-slate-200 text-pv-slate-400'}`}
        >
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: DEALER_COLOR, opacity: showDealer ? 1 : 0.4 }} />
          Broker · {nDealer}
        </button>
        <button
          type="button"
          onClick={() => setShowAgenzia((v) => !v)}
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium ${showAgenzia ? 'border-pv-slate-300 text-pv-slate-900' : 'border-pv-slate-200 text-pv-slate-400'}`}
        >
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: AGENZIA_COLOR, opacity: showAgenzia ? 1 : 0.4 }} />
          Agenzie · {nAgenzia}
        </button>
      </div>

      {loadError && (
        <div className="rounded-[10px] border border-pv-slate-200 bg-pv-slate-50 p-4 text-[13px] text-pv-slate-500">
          Mappa non caricata: verifica la chiave/permessi Google.
        </div>
      )}

      <div ref={mapRef} className="h-[70vh] w-full overflow-hidden rounded-[12px] border border-pv-slate-200" />

      {nonGeolocalizzate > 0 && (
        <p className="text-[12px] text-pv-slate-500">
          {nonGeolocalizzate} sedi non ancora geolocalizzate (indirizzo non trovato): non compaiono sulla mappa.
        </p>
      )}
    </div>
  );
}
