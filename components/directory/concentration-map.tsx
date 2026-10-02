import { countryNameForCode } from '@/lib/membership/countries';
import type { ConcentrationArea } from '@/lib/directory/aggregate';

/**
 * Server-rendered infographic (plain inline SVG, no client JS and no mapping/geocoding library --
 * this codebase stores country codes, not coordinates, and never derives or exposes exact
 * coordinates per docs/05). Bars are proportional to each area's already-thresholded member count.
 * A real HTML table with the same rows always renders beneath it -- not a decorative aria-only
 * duplicate -- so the same information is available with images/SVG disabled, with a screen reader,
 * or when printed, satisfying the "accessible fallback content" requirement outright rather than
 * relying on aria attributes alone.
 */
export function ConcentrationMap({ areas }: { areas: ConcentrationArea[] }) {
  const maxCount = Math.max(...areas.map((area) => area.memberCount));
  const barHeight = 28;
  const gap = 10;
  const chartHeight = areas.length * (barHeight + gap);
  const summary = areas.slice(0, 5).map((area) => `${countryNameForCode(area.countryCode)} (${area.memberCount})`).join(', ');

  return (
    <figure className="mt-10">
      <svg
        aria-label={`Member concentration by country. Leading countries: ${summary}.`}
        className="w-full"
        height={chartHeight}
        role="img"
        viewBox={`0 0 400 ${chartHeight}`}
      >
        {areas.map((area, index) => {
          const y = index * (barHeight + gap);
          const width = Math.max((area.memberCount / maxCount) * 260, 4);
          return (
            <g key={area.countryCode}>
              <text className="fill-muted-foreground text-[10px]" x="0" y={y + barHeight / 2 + 4}>
                {countryNameForCode(area.countryCode)}
              </text>
              <rect className="fill-gold" height={barHeight - 8} rx="2" width={width} x="120" y={y + 4} />
              <text className="fill-foreground text-[10px]" x={128 + width} y={y + barHeight / 2 + 4}>
                {area.memberCount}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        Number of currently entitled IDOC members per country. Countries with fewer than the
        published minimum are not shown.
      </figcaption>

      <div className="mt-8 overflow-x-auto border border-border">
        <table className="w-full min-w-[24rem] text-left text-sm">
          <caption className="sr-only">Member count by country</caption>
          <thead>
            <tr className="border-b border-border bg-surface/50 text-[0.68rem] uppercase tracking-[0.16em] text-muted-foreground">
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
