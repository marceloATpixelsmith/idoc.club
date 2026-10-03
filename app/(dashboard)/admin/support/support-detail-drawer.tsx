import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { AdminFormDrawer } from '@/components/admin/admin-form-drawer';
import { AdminFormSection } from '@/components/admin/admin-form-section';
import { SupportForm } from '@/components/support/support-form';
import { Label } from '@/components/ui/label';
import { CATEGORY_LABELS, getAdminConversation, listEligibleAdministrators, STATUS_LABELS } from '@/lib/support/inbox';
import { assignSupportConversation, changeSupportConversationStatus, replyToSupportAsAdmin } from './actions';

export async function SupportDetailDrawer({ publicId }: { publicId: string }) {
  const [conversation, administrators] = await Promise.all([
    getAdminConversation(publicId),
    listEligibleAdministrators(),
  ]);
  if (!conversation) notFound();

  return (
    <AdminFormDrawer closeHref="/admin/support" title={String(conversation.subject)}>
      <div className="space-y-4 px-5 py-6 lg:px-8">
        <AdminFormSection
          description={String(conversation.member_name) + ' · ' + String(conversation.member_email) + ' · ' + CATEGORY_LABELS[conversation.category as keyof typeof CATEGORY_LABELS] + ' · ' + STATUS_LABELS[String(conversation.status)]}
          title="Conversation"
        >
          <ol className="space-y-3">
            {conversation.messages.map((message, index) => (
              <li className={'rounded-lg border p-4 ' + (message.author_side === 'admin' ? 'bg-muted' : '')} key={String(message.created_at) + '-' + index}>
                <p className="mb-2 text-sm font-semibold">{message.author_side === 'admin' ? 'Administrator' : 'Member'} · {new Date(String(message.created_at)).toLocaleString()}</p>
                <p className="whitespace-pre-wrap break-words">{String(message.body)}</p>
              </li>
            ))}
          </ol>
        </AdminFormSection>

        <AdminFormSection title="Reply">
          <SupportForm action={replyToSupportAsAdmin} pendingLabel="Sending" submitLabel="Send administrator reply">
            <input name="idempotencyKey" type="hidden" value={randomUUID()} />
            <input name="publicId" type="hidden" value={publicId} />
            <div className="space-y-1.5">
              <Label htmlFor="supportReply">Message</Label>
              <textarea className="block min-h-36 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" id="supportReply" maxLength={10000} name="body" required />
            </div>
          </SupportForm>
        </AdminFormSection>

        <div className="grid gap-4 md:grid-cols-2">
          <AdminFormSection title="Assignment">
            <SupportForm action={assignSupportConversation} submitLabel="Save assignment">
              <input name="publicId" type="hidden" value={publicId} />
              <div className="space-y-1.5">
                <Label htmlFor="administratorIds">Administrators</Label>
                <select className="block min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" defaultValue={conversation.assigned_admin_keys.map(String)} id="administratorIds" multiple name="administratorIds">
                  {administrators.map((admin) => <option key={String(admin.assignment_key)} value={String(admin.assignment_key)}>{String(admin.display_name)}</option>)}
                </select>
                <p className="text-sm text-muted-foreground">Use Ctrl/Command to select more than one administrator.</p>
              </div>
            </SupportForm>
          </AdminFormSection>

          <AdminFormSection description="Use this toggle to resolve or reopen the ticket." title="Workflow">
            <SupportForm action={changeSupportConversationStatus} submitLabel="Save workflow">
              <input name="publicId" type="hidden" value={publicId} />
              <label className="flex items-center justify-between gap-4 rounded-md border border-input p-3">
                <span><span className="block font-medium">Closed</span><span className="block text-sm text-muted-foreground">Mark this support ticket resolved.</span></span>
                <input defaultChecked={conversation.status === 'closed'} className="size-5" name="closed" type="checkbox" value="1" />
              </label>
            </SupportForm>
          </AdminFormSection>
        </div>
      </div>
    </AdminFormDrawer>
  );
}
