'use client';

import { Suspense, useActionState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { updateAccount } from '@/app/(login)/actions';
import type { PublicUser } from '@/lib/db/queries';
import { CsrfField } from '@/components/security/csrf-field';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type ActionState = {
  name?: string;
  error?: string;
  success?: string;
};

type AccountFieldsProps = {
  state: ActionState;
  nameValue?: string;
  emailValue?: string;
};

function AccountFields({ state, nameValue = '', emailValue = '' }: AccountFieldsProps) {
  return (
    <>
      <div>
        <Label htmlFor="name" className="mb-2">Name</Label>
        <Input id="name" name="name" placeholder="Enter your name" defaultValue={state.name || nameValue} required />
      </div>
      <div>
        <Label htmlFor="email" className="mb-2">Email</Label>
        <Input id="email" name="email" type="email" placeholder="Enter your email" defaultValue={emailValue} required />
      </div>
    </>
  );
}

function AccountFieldsWithData({ state }: { state: ActionState }) {
  const { data: user } = useSWR<PublicUser>('/api/user', fetcher);
  return <AccountFields state={state} nameValue={user?.name ?? ''} emailValue={user?.email ?? ''} />;
}

export function AccountForm() {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(updateAccount, {});
  return (
    <Card>
      <CardHeader><CardTitle>Name and email</CardTitle></CardHeader>
      <CardContent>
        <form className="space-y-4" action={formAction}>
          <CsrfField />
          <Suspense fallback={<AccountFields state={state} />}>
            <AccountFieldsWithData state={state} />
          </Suspense>
          {state.error ? <p className="text-red-400 text-sm">{state.error}</p> : null}
          {state.success ? <p className="text-green-400 text-sm">{state.success}</p> : null}
          <Button type="submit" className="bg-primary hover:opacity-90 text-primary-foreground" disabled={isPending}>
            {isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : 'Save Changes'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
