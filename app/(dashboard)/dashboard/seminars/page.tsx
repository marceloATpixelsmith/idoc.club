import { redirect } from 'next/navigation';
import { getOwnPrivateMember } from '@/lib/membership/data-access';
import { isEntitled } from '@/lib/membership/entitlement';

// Seminar authoring, registration, and payment are Release 5 scope (docs/08-product-roadmap-and-
// functional-requirements.md) and do not exist yet -- there is no seminar data anywhere in this
// application. This tab exists so the member-facing navigation already matches the requested final
// shape; it renders an honest empty state rather than fabricating seminar data.
export default async function SeminarsPage() {
  const member = await getOwnPrivateMember();
  if (!member) redirect('/onboarding');
  if (!isEntitled(member.entitlement, new Date().toISOString().slice(0, 10))) redirect('/dashboard');
  return (
    <main className="flex-1 p-4 lg:p-8">
      <h1 className="text-2xl font-semibold">My Seminars</h1>
      <p className="mt-3 text-muted-foreground">You have no seminar registrations yet.</p>
    </main>
  );
}
