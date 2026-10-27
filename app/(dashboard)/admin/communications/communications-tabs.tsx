'use client';

import { useState, type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Panels = { issues: ReactNode; renewal: ReactNode; system: ReactNode; upcoming: ReactNode };

/** One tab per section of the Communications report. Sent sections point at the Delivery issues tab when any of their emails need a look. */
export function CommunicationsTabs({ issueCounts, panels }: { issueCounts: { activation: number; renewal: number; system: number }; panels: Panels }) {
  const [tab, setTab] = useState('system');
  const total = issueCounts.renewal + issueCounts.system + issueCounts.activation;
  const notice = (count: number, activation = 0) => count > 0 || activation > 0
    ? <p className="rounded-lg border border-amber-400/50 bg-amber-950/20 p-4 text-sm text-amber-200" role="status">{count > 0 ? `${count} ${count === 1 ? 'email was' : 'emails were'} not confirmed as delivered.` : ''} {activation > 0 ? `${activation} ${activation === 1 ? 'member has' : 'members have'} requested activation emails repeatedly without activating.` : ''} <button className="bg-transparent font-medium normal-case tracking-normal underline underline-offset-4 hover:opacity-80" onClick={() => setTab('issues')} type="button">See which addresses on the Delivery issues tab</button></p>
    : null;
  return (
    <Tabs onValueChange={setTab} value={tab}>
      <TabsList aria-label="Communications sections">
        <TabsTrigger value="system">System emails</TabsTrigger>
        <TabsTrigger value="renewal">Renewal notices sent</TabsTrigger>
        <TabsTrigger value="upcoming">Upcoming notices</TabsTrigger>
        <TabsTrigger value="issues">Delivery issues{total > 0 ? ` (${total})` : ''}</TabsTrigger>
      </TabsList>
      <TabsContent className="space-y-6" value="system">{notice(issueCounts.system, issueCounts.activation)}{panels.system}</TabsContent>
      <TabsContent className="space-y-6" value="renewal">{notice(issueCounts.renewal)}{panels.renewal}</TabsContent>
      <TabsContent className="space-y-6" value="upcoming">{panels.upcoming}</TabsContent>
      <TabsContent className="space-y-6" value="issues">{panels.issues}</TabsContent>
    </Tabs>
  );
}
