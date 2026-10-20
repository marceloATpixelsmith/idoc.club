import { COUNTRY_CENTROIDS } from './country-centroids.ts';

export const MAP_DOT_MIN_RADIUS = 6;
export const MAP_DOT_MAX_RADIUS = 34;

export type MemberMapDot = {
  countryCode: string;
  countryName: string;
  lat: number;
  lng: number;
  memberCount: number;
  radius: number;
};

/**
 * Dot radius in pixels. Dot AREA, not radius, is proportional to the member count, so a country with
 * four times the members covers four times the area. The largest country gets MAP_DOT_MAX_RADIUS and
 * very small counts never shrink below MAP_DOT_MIN_RADIUS so they stay visible and clickable.
 */
export function dotRadius(memberCount: number, maxCount: number): number {
  if (maxCount <= 0 || memberCount <= 0) return MAP_DOT_MIN_RADIUS;
  return Math.max(MAP_DOT_MIN_RADIUS, MAP_DOT_MAX_RADIUS * Math.sqrt(memberCount / maxCount));
}

/**
 * Turns the already-thresholded per-country counts into map dots at each country's fixed center. A
 * country with no known center is skipped here (it still appears in the accessible table).
 */
export function buildMemberMapDots(
  areas: { countryCode: string; memberCount: number }[],
  countryName: (code: string) => string,
): MemberMapDot[] {
  const maxCount = Math.max(0, ...areas.map((area) => area.memberCount));
  return areas.flatMap((area) => {
    const center = COUNTRY_CENTROIDS[area.countryCode];
    if (!center) return [];
    return [{
      countryCode: area.countryCode,
      countryName: countryName(area.countryCode),
      lat: center[1],
      lng: center[0],
      memberCount: area.memberCount,
      radius: Math.round(dotRadius(area.memberCount, maxCount) * 10) / 10,
    }];
  });
}
