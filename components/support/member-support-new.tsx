import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { NewTicketChat } from '@/components/support/member-support-chat';
import { BackLink } from '@/components/ui/back-link';
import { getMainNavAccess } from '@/lib/auth/user-menu-access';
import { CATEGORY_LABELS, SUPPORT_CATEGORIES } from '@/lib/support/inbox';
import { createSupportConversation } from '@/app/(dashboard)/dashboard/support/actions';

export async function MemberSupportNew() {
  const navAccess = await getMainNavAccess();
  if (!navAccess.memberSupport) redirect('/contact');
  const categories = SUPPORT_CATEGORIES.map((category) => ({ label: CATEGORY_LABELS[category], value: category }));
  return <div className="mx-auto max-w-3xl px-5 pb-10 lg:px-8"><BackLink href="/contact">Back to My Support Tickets</BackLink>
    <header className="mb-6 border-b pb-5"><h1 className="text-2xl font-semibold">New support ticket</h1></header>
    <NewTicketChat action={createSupportConversation} categories={categories} idempotencyKey={randomUUID()} />
  </div>;
}
