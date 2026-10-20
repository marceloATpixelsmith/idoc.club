import { countryNameForCode } from '@/lib/membership/countries';
import type { ConcentrationArea } from '@/lib/directory/aggregate';
import { buildMemberMapDots } from '@/lib/directory/map-dots';
import { MemberMapCanvas } from './member-map-canvas';

/**
 * Interactive MapLibre dot map (bundled Natural Earth country shapes, no external tile or style
 * requests). One gold dot per country sits at a fixed country center, sized so dot area is
 * proportional to the already-thresholded member count -- this codebase stores country codes, not
 * coordinates, and never derives or exposes exact coordinates per docs/05. A real HTML table with the
 * same rows always renders beneath it -- not a decorative aria-only duplicate -- so the same
 * information is available with WebGL disabled, with a screen reader, or when printed.
 */
export function ConcentrationMap({ areas }: { areas: ConcentrationArea[] }) {
  const dots = buildMemberMapDots(areas, countryNameForCode);
  const summary = areas.slice(0, 5).map((area) => `${countryNameForCode(area.countryCode)} (${area.memberCount})`).join(', ');

  return (
    <figure className="mt-10">
      <MemberMapCanvas dots={dots} summary={summary} />
      <figcaption className="mt-3 text-xs text-muted-foreground">
        Dot size is proportional to the number of currently entitled IDOC members in each country. Countries with fewer than the
        published minimum are not shown. Country boundaries: Natural Earth.
      </figcaption>

      <div className="mt-8 overflow-x-auto border border-border">
        <table className="w-full min-w-[24rem] text-left text-sm">
          <caption className="sr-only">Member count by country</caption>
          <thead>
            <tr className="border-b border-border bg-surface/50 text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <th className="px-6 py-4 font-medium" scope="col">Country</th>
              <th className="px-6 py-4 font-medium" scope="col">Members</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {areas.map((area) => (
              <tr key={area.countryCode}>
                <td className="px-6 py-4 font-display text-lg">{countryNameForCode(area.countryCode)}</td>
                <td className="px-6 py-4 text-muted-foreground">{area.memberCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
