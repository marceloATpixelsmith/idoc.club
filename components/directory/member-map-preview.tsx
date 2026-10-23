import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { countryNameForCode } from '@/lib/membership/countries';
import type { ConcentrationArea } from '@/lib/directory/aggregate';
import { buildMemberMapDots } from '@/lib/directory/map-dots';
import { MemberMapCanvas } from './member-map-canvas';

/**
 * Small static thumbnail of the public member map for the homepage. It uses the same privacy-safe
 * aggregate as the full map (country code and count only). The whole tile is one link to the
 * interactive map; on hover or keyboard focus a semitransparent blue overlay slides up over it.
 */
export function MemberMapPreview({ areas }: { areas: ConcentrationArea[] }) {
  const dots = buildMemberMapDots(areas, countryNameForCode);
  return (
    <Link
      aria-label="View interactive map of IDOC members worldwide"
      className="group relative block w-full overflow-hidden border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
      href="/about/members-directory"
    >
      <MemberMapCanvas dots={dots} preview summary="" />
      <span className="absolute inset-0 flex translate-y-full items-center justify-center gap-2 bg-blue-600/70 text-xs font-semibold uppercase tracking-[0.2em] text-white transition-transform duration-300 ease-out group-hover:translate-y-0 group-focus-visible:translate-y-0 motion-reduce:transition-none">
        View Interactive Map <ArrowUpRight aria-hidden="true" className="size-4" />
      </span>
    </Link>
  );
}
