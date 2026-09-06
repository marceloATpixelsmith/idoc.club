'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { Menu, X, ChevronDown, Facebook } from 'lucide-react';
import type { PublicUser } from '@/lib/db/queries';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const nav = [
  { href: '/', label: 'Home' },
  { href: '/seminars', label: 'Seminars' },
  { href: '/membership', label: 'Membership' },
  { href: '/contact', label: 'Contact' },
] as const;

const aboutLinks = [
  { href: '/about', label: 'About' },
  { href: '/about/board-members', label: 'Board Members' },
  { href: '/about/general-assembly', label: 'General Assembly' },
  { href: '/about/members-directory', label: 'Members Directory' },
] as const;

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function navClassName(active: boolean) {
  return `text-[0.8rem] font-medium uppercase tracking-[0.14em] transition-colors ${active ? 'text-gold' : 'text-muted-foreground hover:text-foreground'}`;
}

function AboutDropdown({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const active = aboutLinks.some((item) => isActive(pathname, item.href));

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <Link href="/about" className={`flex items-center gap-1 ${navClassName(active)}`}>
        About IDOC
        <ChevronDown className="size-3" />
      </Link>

      {open && (
        <div className="absolute left-0 top-full z-[60] min-w-[16rem] border border-border bg-background/95 pt-2 backdrop-blur-md">
          <ul className="flex flex-col">
            {aboutLinks.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block px-5 py-3 text-[0.72rem] font-medium uppercase tracking-[0.14em] transition-colors hover:bg-surface hover:text-foreground ${isActive(pathname, item.href) ? 'text-gold' : 'text-muted-foreground'}`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MemberAreaLink({ className }: { className?: string }) {
  const { data: user } = useSWR<PublicUser>('/api/user', fetcher);

  if (user?.email) {
    return (
      <Link href="/dashboard" className={className}>
        My Dashboard
      </Link>
    );
  }

  return (
    <Link href="/sign-in" className={className}>
      Member Login
    </Link>
  );
}

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-24 max-w-7xl items-center justify-between gap-6 px-5 lg:px-8">
        <Link href="/" className="flex items-center gap-3" onClick={() => setOpen(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img src="/idoc-logo.svg" alt="IDOC — International Dressage Officials Club" className="h-14 w-auto" />
        </Link>

        <div className="hidden items-center gap-10 lg:flex">
          <nav className="flex items-center gap-7">
            <Link href="/" className={navClassName(isActive(pathname, '/'))}>
              Home
            </Link>

            <AboutDropdown pathname={pathname} />

            {nav.slice(1).map((item) => (
              <Link key={item.href} href={item.href} className={navClassName(isActive(pathname, item.href))}>
                {item.label}
              </Link>
            ))}

            <span className="text-border" aria-hidden="true">
              |
            </span>
            <a
              href="https://www.facebook.com/groups/646981818825549/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="IDOC on Facebook"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <Facebook className="size-4" />
            </a>
          </nav>

          <MemberAreaLink className="rounded-full border border-gold/60 px-4 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-gold transition-colors hover:bg-gold hover:text-primary-foreground" />
        </div>

        <button
          type="button"
          aria-label="Toggle navigation"
          onClick={() => setOpen((v) => !v)}
          className="text-foreground lg:hidden"
        >
          {open ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </div>

      {open && (
        <nav className="border-t border-border bg-background px-5 py-4 lg:hidden">
          <ul className="flex flex-col gap-1">
            <li>
              <Link
                href="/"
                onClick={() => setOpen(false)}
                className="block py-2 text-sm uppercase tracking-[0.14em] text-muted-foreground"
              >
                Home
              </Link>
            </li>
            <li className="pt-2">
              <p className="px-1 py-1 text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-gold">
                About IDOC
              </p>
              <ul className="flex flex-col">
                {aboutLinks.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="block py-2 pl-3 text-sm uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
            {nav.slice(1).map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block py-2 text-sm uppercase tracking-[0.14em] text-muted-foreground"
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <a
                href="https://www.facebook.com/groups/646981818825549/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 py-2 text-sm uppercase tracking-[0.14em] text-muted-foreground"
              >
                <Facebook className="size-4" />
                Facebook
              </a>
            </li>
            <li>
              <MemberAreaLink className="mt-3 block rounded-full border border-gold/60 px-4 py-2 text-center text-xs font-semibold uppercase tracking-[0.18em] text-gold" />
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
