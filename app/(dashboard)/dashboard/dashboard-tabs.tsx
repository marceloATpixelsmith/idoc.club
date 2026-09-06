'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Users, Shield, Menu, UserCog, GraduationCap } from 'lucide-react';

const ALL_TABS = [
  { href: '/dashboard', icon: Users, label: 'My Membership' },
  { href: '/dashboard/profile', icon: UserCog, label: 'My Profile' },
  { href: '/dashboard/security', icon: Shield, label: 'My Security' },
  { href: '/dashboard/seminars', icon: GraduationCap, label: 'My Seminars' },
];

/** Before payment, the member has no dashboard capability beyond paying -- see dashboard/page.tsx's
 * paywall gate, which is the actual enforcement point. This only keeps the tab bar itself from
 * inviting a click into a tab that would just bounce back to My Membership; it is UI convenience,
 * never an authorization boundary on its own. */
export function DashboardTabs({ entitled }: { entitled: boolean }) {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const tabs = entitled ? ALL_TABS : ALL_TABS.slice(0, 1);

  return (
    <>
      <div className="lg:hidden flex items-center justify-between bg-white border-b border-gray-200 p-4">
        <span className="font-medium">Dashboard</span>
        <Button className="-mr-3" variant="ghost" onClick={() => setIsMenuOpen(!isMenuOpen)}>
          <Menu className="h-6 w-6" />
          <span className="sr-only">Toggle navigation</span>
        </Button>
      </div>
      <nav className={`flex-col gap-1 border-b border-gray-200 bg-white p-2 lg:flex lg:flex-row lg:gap-1 lg:border-0 lg:bg-transparent lg:p-0 ${isMenuOpen ? 'flex' : 'hidden'}`}>
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href} onClick={() => setIsMenuOpen(false)}>
            <Button
              variant="ghost"
              className={`w-full justify-start gap-2 rounded-none border-b-2 border-transparent shadow-none lg:w-auto lg:justify-center ${pathname === tab.href ? 'border-gray-900 text-gray-900' : 'text-gray-500'}`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </Button>
          </Link>
        ))}
      </nav>
    </>
  );
}
