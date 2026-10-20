import { countryNameForCode } from '@/lib/membership/countries';
import type { ConcentrationArea } from '@/lib/directory/aggregate';
import { buildMemberMapDots } from '@/lib/directory/map-dots';
import { MemberMapCanvas } from './member-map-canvas';

/**
 * Interactive MapLibre dot map (bundled Natural Earth country shapes, no external tile or style
 * requests). One gold dot per country sits at a fixed country center, sized so dot area is
 * proportional to the already-thresholded member count -- this codebase stores country codes, not
 * coordinates, and never derives or exposes exact coordinates per docs/05. A real HTML table with the
 * same rows is always in the DOM but visually hidden (sr-only) -- not a decorative aria-only
 * duplicate -- so the same information stays available to screen readers and assistive technology.
 */
export function ConcentrationMap({ areas }: { areas: ConcentrationArea[] }) {
  const dots = buildMemberMapDots(areas, countryNameForCode);
  const summary = areas.slice(0, 5).map((area) => `${countryNameForCode(area.countryCode)} (${area.memberCount})`).join(', ');

  return (
    <figure>
      <MemberMapCanvas dots={dots} summary={summary} />
      <div className="sr-only">
        <table>
          <caption>Member count by country</caption>
          <thead>
            <tr>
              <th scope="col">Country</th>
              <th scope="col">Members</th>
            </tr>
          </thead>
          <tbody>
            {areas.map((area) => (
              <tr key={area.countryCode}>
                <td>{countryNameForCode(area.countryCode)}</td>
                <td>{area.memberCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
