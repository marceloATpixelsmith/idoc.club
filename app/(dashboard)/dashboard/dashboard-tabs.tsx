'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Users, Shield, Menu, UserCog, GraduationCap, LifeBuoy, Search } from 'lucide-react';

const ALL_TABS = [
  { href: '/dashboard', icon: Users, label: 'My Membership' },
  { href: '/dashboard/profile', icon: UserCog, label: 'My Profile' },
  { href: '/dashboard/security', icon: Shield, label: 'My Security' },
  { href: '/dashboard/seminars', icon: GraduationCap, label: 'My Seminars' },
  { href: '/dashboard/directory', icon: Search, label: 'Directory' },
  { href: '/dashboard/support', icon: LifeBuoy, label: 'Support' },
];

/** Before payment, the member has no dashboard capability beyond paying -- see dashboard/page.tsx's
 * paywall gate, which is the actual enforcement point. A "menu" offering exactly one destination
 * you can't leave isn't a menu, so this renders nothing at all rather than a single-item bar; once
 * entitled (or for a privileged administrator/super_admin, who is never gated by payment status),
 * the real bar appears. This is UI convenience, never an authorization boundary on its own. */
export function DashboardTabs({ entitled, memberSupport, supportUnread }: { entitled: boolean; memberSupport: boolean; supportUnread: number }) {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  if (!entitled) return null;

  return (
    <>
      <div className="flex items-center justify-between border-b border-border bg-surface/50 px-5 py-4 lg:hidden">
        <div><p className="eyebrow">Member area</p><span className="font-display text-xl">My Dashboard</span></div>
        <Button className="-mr-3" variant="ghost" onClick={() => setIsMenuOpen(!isMenuOpen)}>
          <Menu className="h-6 w-6" />
          <span className="sr-only">Toggle navigation</span>
        </Button>
      </div>
      <nav aria-label="My Dashboard" className={`flex-col gap-1 border-b border-border bg-surface/50 px-3 pb-5 pt-2 lg:min-h-[calc(100dvh-96px)] lg:w-72 lg:shrink-0 lg:border-b-0 lg:border-r lg:px-3 lg:pb-5 lg:pt-8 ${isMenuOpen ? 'flex' : 'hidden'} lg:flex`}>
        <div className="hidden px-3 pb-5 lg:block"><p className="eyebrow">Member area</p><p className="mt-1 font-display text-xl text-foreground">My Dashboard</p></div>
        {ALL_TABS.filter((tab) => memberSupport || tab.href !== '/dashboard/support').map((tab) => (
          <Link key={tab.href} href={tab.href} onClick={() => setIsMenuOpen(false)}>
            <Button
              variant="ghost"
              className={`w-full justify-start gap-3 rounded-md border-l-2 border-transparent px-3 shadow-none ${pathname === tab.href ? 'border-gold bg-background text-foreground' : 'text-muted-foreground hover:bg-background/70'}`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
              {tab.href === '/dashboard/support' && supportUnread > 0 ? <span aria-label={`${supportUnread} unread support replies`} className="rounded-full bg-primary px-2 py-0.5 text-primary-foreground">{supportUnread}</span> : null}
            </Button>
          </Link>
        ))}
      </nav>
    </>
  );
}
