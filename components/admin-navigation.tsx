'use client';

import {
  Bell,
  BookOpen,
  Building2,
  CreditCard,
  FileDown,
  GraduationCap,
  Headphones,
  LayoutDashboard,
  LineChart,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const SHARED_ITEMS = [
  { href: '/admin', icon: LayoutDashboard, label: 'Overview' },
  { href: '/admin/members', icon: Users, label: 'Members' },
  { href: '/admin/revenue', icon: LineChart, label: 'Revenue' },
  { href: '/admin/payments', icon: CreditCard, label: 'Manual payments' },
  { href: '/admin/exports', icon: FileDown, label: 'Exports' },
  { href: '/admin/reconciliation', icon: WalletCards, label: 'Stripe reconciliation' },
  { href: '/admin/notifications', icon: Bell, label: 'Notifications' },
  { href: '/admin/support', icon: Headphones, label: 'Support inbox' },
  { href: '/admin/news', icon: BookOpen, label: 'News / Blog' },
  { href: '/admin/seminars', icon: GraduationCap, label: 'Seminars' },
] as const;

const SUPER_ADMIN_ITEMS = [
  { href: '/admin/organization', icon: Building2, label: 'Organization settings' },
  { href: '/admin/support/defaults', icon: Settings, label: 'Support defaults' },
  { href: '/admin/security', icon: ShieldCheck, label: 'Security operations' },
] as const;

function isActive(pathname: string, href: string) {
  return href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNavigation({ isSuperAdmin, unreadCount }: { isSuperAdmin: boolean; unreadCount: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = isSuperAdmin ? [...SHARED_ITEMS, ...SUPER_ADMIN_ITEMS] : SHARED_ITEMS;
  const activeHref = items.filter((item) => isActive(pathname, item.href))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;

  return (
    <aside className="border-b border-border bg-surface/50 lg:min-h-[calc(100dvh-96px)] lg:w-72 lg:shrink-0 lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between px-5 py-4 lg:block lg:px-6 lg:pb-5 lg:pt-8">
        <div>
          <p className="eyebrow">IDOC administration</p>
          <p className="mt-1 font-display text-xl text-foreground">Admin Dashboard</p>
        </div>
        <button
          aria-expanded={open}
          aria-label="Toggle admin navigation"
          className="rounded-md p-2 text-muted-foreground hover:bg-background hover:text-foreground lg:hidden"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      <nav aria-label="Admin Dashboard" className={`${open ? 'block' : 'hidden'} px-3 pb-5 lg:block`}>
        <p className="px-3 pb-2 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Administration</p>
        <ul className="space-y-1">
          {items.map((item, index) => {
            const beginsSuperAdminSection = isSuperAdmin && index === SHARED_ITEMS.length;
            const active = activeHref === item.href;
            return (
              <li className={beginsSuperAdminSection ? 'mt-6 border-t border-border pt-6' : ''} key={item.href}>
                {beginsSuperAdminSection && <p className="px-3 pb-2 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-gold">Super Admin</p>}
                <Link
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-md border-l-2 px-3 py-2.5 text-sm transition-colors ${active ? 'border-gold bg-background text-foreground shadow-sm' : 'border-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground'}`}
                  href={item.href}
                  onClick={() => setOpen(false)}
                >
                  <item.icon aria-hidden="true" className="size-4 shrink-0" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
