'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type { MemberMapDot } from '@/lib/directory/map-dots';

// MapLibre cannot parse the oklch() tokens in app/globals.css, so the same brand colors are fixed
// hex equivalents: --background (ocean), --surface-raised (land), --gold (borders and dots).
const OCEAN = '#050c20';
const LAND = '#14203c';
const GOLD = '#d3af37';

export function MemberMapCanvas({ dots, summary }: { dots: MemberMapDot[]; summary: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let cancelled = false;
    let teardown: (() => void) | undefined;

    (async () => {
      try {
        const maplibre = await import('maplibre-gl');
        if (cancelled) return;
        const map = new maplibre.Map({
          attributionControl: false,
          container: element,
          cooperativeGestures: true,
          center: [10, 25],
          maxZoom: 5,
          minZoom: 0.8,
          renderWorldCopies: false,
          style: {
            version: 8,
            sources: {
              countries: { type: 'geojson', data: '/geo/world-countries.geojson' },
              members: {
                type: 'geojson',
                data: {
                  type: 'FeatureCollection',
                  features: dots.map((dot) => ({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [dot.lng, dot.lat] },
                    properties: { countryName: dot.countryName, memberCount: dot.memberCount, radius: dot.radius },
                  })),
                },
              },
            },
            layers: [
              { id: 'ocean', type: 'background', paint: { 'background-color': OCEAN } },
              { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': LAND } },
              { id: 'borders', type: 'line', source: 'countries', paint: { 'line-color': GOLD, 'line-width': 0.8, 'line-opacity': 0.85 } },
              {
                id: 'member-dots',
                type: 'circle',
                source: 'members',
                // Largest first so small dots are never hidden beneath a big one.
                layout: { 'circle-sort-key': ['-', 0, ['get', 'memberCount']] },
                paint: {
                  'circle-color': GOLD,
                  'circle-opacity': 0.7,
                  'circle-radius': ['get', 'radius'],
                  'circle-stroke-color': '#f3e3a0',
                  'circle-stroke-width': 1,
                },
              },
            ],
          },
        });
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');

        const popup = new maplibre.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
        map.on('mousemove', 'member-dots', (event) => {
          const properties = event.features?.[0]?.properties;
          if (!properties) return;
          map.getCanvas().style.cursor = 'pointer';
          const text = document.createElement('div');
          text.className = 'text-xs font-medium text-neutral-900';
          text.textContent = `${properties.countryName}: ${properties.memberCount} members`;
          popup.setLngLat(event.lngLat).setDOMContent(text).addTo(map);
        });
        map.on('mouseleave', 'member-dots', () => {
          map.getCanvas().style.cursor = '';
          popup.remove();
        });
        map.on('error', () => {
          if (!map.loaded()) setFailed(true);
        });
        teardown = () => map.remove();
        if (cancelled) teardown();
      } catch {
        // Typically WebGL being unavailable; the data table beneath remains the full fallback.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [dots]);

  if (failed) {
    return <p className="border border-border bg-surface/50 p-6 text-sm text-muted-foreground">The interactive map could not be displayed in this browser. The member counts are listed below.</p>;
  }
  return <div aria-label={`Map of member concentration by country. Leading countries: ${summary}.`} className="h-[420px] w-full overflow-hidden border border-border sm:h-[520px]" ref={container} role="img" />;
}
