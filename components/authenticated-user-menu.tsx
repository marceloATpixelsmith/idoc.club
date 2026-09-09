'use client';

import { Home, LayoutDashboard, LogOut } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type PointerEvent, type ReactNode, useRef, useState } from 'react';
import useSWR, { mutate } from 'swr';
import { signOut } from '@/app/(login)/actions';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { PublicUser } from '@/lib/db/queries';
import { userInitials } from '@/lib/format/user-initials';
import { readCsrfTokenFromDocumentCookie } from '@/lib/security/csrf-client';

const fetcher = (url: string) => fetch(url).then((response) => response.json());
//Radix renders the menu content in a portal. Give the pointer time to cross from the
//trigger into that portaled content before closing the hover-open menu.
const HOVER_CLOSE_DELAY_MS = 500;

type AuthenticatedUserMenuProps = {
  loggedOut: ReactNode;
  onNavigate?: () => void;
  showAdminDashboard: boolean;
};

export function AuthenticatedUserMenu({
  loggedOut,
  onNavigate,
  showAdminDashboard,
}: AuthenticatedUserMenuProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: user } = useSWR<PublicUser | null>('/api/user', fetcher);
  const router = useRouter();

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function openForMouse(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return;
    cancelClose();
    setOpen(true);
  }

  function closeForMouse(event: PointerEvent) {
    if (event.pointerType !== 'mouse') return;
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  }

  function handleNavigate() {
    setOpen(false);
    onNavigate?.();
  }

  async function handleSignOut() {
    await signOut(readCsrfTokenFromDocumentCookie());
    await mutate('/api/user');
    setOpen(false);
    onNavigate?.();
    router.push('/');
  }

  if (!user?.email) return loggedOut;

  const accessibleName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'User';

  return (
    //modal=false: modal mode locks body scroll and shifts the sticky header by the
    //scrollbar width, nudging this hover-opened trigger out from under the cursor and
    //causing an open/close/open flicker loop while the mouse sits still.
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <div onPointerEnter={openForMouse} onPointerLeave={closeForMouse}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Open ${accessibleName} menu`}
            className="rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onPointerDown={(event) => {
              //A hover-open menu is already visible when the pointer reaches the trigger.
              //Prevent Radix from toggling it closed on the follow-up mouse click; keyboard
              //and touch interaction retain Radix's normal toggle behavior.
              if (event.pointerType === 'mouse' && open) event.preventDefault();
            }}
          >
            <Avatar className="size-9 cursor-pointer bg-gold shadow-gold">
              <AvatarFallback className="bg-gold font-display text-sm font-bold tracking-wide text-primary-foreground">
                {userInitials(user.firstName, user.lastName, user.email)}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent
        align="end"
        className="flex min-w-48 flex-col gap-1"
        onPointerEnter={openForMouse}
        onPointerLeave={closeForMouse}
      >
        <DropdownMenuItem asChild>
          <Link href="/dashboard" onClick={handleNavigate}>
            <Home />
            <span>My Dashboard</span>
          </Link>
        </DropdownMenuItem>
        {showAdminDashboard && (
          <DropdownMenuItem asChild>
            <Link href="/admin" onClick={handleNavigate}>
              <LayoutDashboard />
              <span>Admin Dashboard</span>
            </Link>
          </DropdownMenuItem>
        )}
        <form action={handleSignOut} className="w-full">
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut />
              <span>Sign out</span>
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
