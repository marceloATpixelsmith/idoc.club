'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { openDirectoryForCountry } from './open-directory-for-country';
import type { MemberMapDot } from '@/lib/directory/map-dots';

// MapLibre cannot parse the oklch() tokens in app/globals.css, so the same brand colors are fixed
// hex equivalents: --background (ocean), --surface-raised (land), --gold (borders and dots).
const OCEAN = '#050c20';
const LAND = '#14203c';
const GOLD = '#d3af37';

export function MemberMapCanvas({ canOpenDirectory = false, dots, summary }: { canOpenDirectory?: boolean; dots: MemberMapDot[]; summary: string }) {
  const container = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [failed, setFailed] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let cancelled = false;
    let teardown: (() => void) | undefined;

    (async () => {
      try {
        const maplibre = await import('maplibre-gl');
        if (cancelled) return;
        // MapLibre v6 resolves its worker next to the library file, which Next's bundler does not emit,
        // so serve the matching worker from public/ (kept in sync by tests/directory.test.ts).
        maplibre.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
        const map = new maplibre.Map({
          attributionControl: false,
          container: element,
          cooperativeGestures: true,
          // Fit the whole world (minus Antarctica) at any container width, so a narrow phone starts
          // zoomed out rather than cropped to a desktop-sized world; users can still zoom in.
          bounds: [[-170, -56], [180, 80]],
          fitBoundsOptions: { padding: 8 },
          maxZoom: 5,
          minZoom: -1,
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
                    properties: { countryCode: dot.countryCode, countryName: dot.countryName, memberCount: dot.memberCount, radius: dot.radius },
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
          // Only signed-in members can open the directory, so only they get a clickable affordance.
          if (canOpenDirectory) map.getCanvas().style.cursor = 'pointer';
          const text = document.createElement('div');
          text.className = 'text-xs font-medium text-neutral-900';
          text.textContent = `${properties.countryName}: ${properties.memberCount} members${canOpenDirectory ? ' \u2014 click to view them' : ''}`;
          popup.setLngLat(event.lngLat).setDOMContent(text).addTo(map);
        });
        if (canOpenDirectory) {
          map.on('click', 'member-dots', async (event) => {
            const countryCode = event.features?.[0]?.properties?.countryCode;
            if (typeof countryCode !== 'string') return;
            setOpenFailed(!(await openDirectoryForCountry(countryCode, (href) => routerRef.current.push(href))));
          });
        }
        map.on('mouseleave', 'member-dots', () => {
          map.getCanvas().style.cursor = '';
          popup.remove();
        });
        map.on('error', (event) => {
          console.warn('Members map error:', event.error?.message);
          if (!map.loaded()) setFailed(true);
        });
        teardown = () => map.remove();
        if (cancelled) teardown();
      } catch {
        // Typically WebGL being unavailable; the screen-reader table in ConcentrationMap still carries the data.
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [canOpenDirectory, dots]);

  if (failed) {
    return <p className="border border-border bg-surface/50 p-6 text-sm text-muted-foreground">The interactive map could not be displayed in this browser.</p>;
  }
  return <>
    <div aria-label={`Map of member concentration by country. Leading countries: ${summary}.`} className="aspect-[4/3] w-full overflow-hidden border border-border sm:aspect-auto sm:h-[520px]" ref={container} role="img" />
    {openFailed ? <p className="mt-3 text-sm text-muted-foreground" role="alert">Could not open the directory. Please try again.</p> : null}
  </>;
}
