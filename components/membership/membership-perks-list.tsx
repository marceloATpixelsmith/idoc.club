import { Check } from 'lucide-react';
import type { MembershipPerk } from '@/lib/organization/membership-perks';

export function MembershipPerksList({ className, perks }: { className?: string; perks: MembershipPerk[] }) {
  return (
    <ul className={className}>
      {perks.map((perk) => (
        <li key={perk.id} className="flex items-start gap-3 text-muted-foreground">
          <Check className="mt-0.5 size-4 shrink-0 text-gold" /> {perk.label}
        </li>
      ))}
    </ul>
  );
}
