'use client';

import { useActionState } from 'react';

type State = { error?: string; success?: string };
type Action = (state: State, data: FormData) => Promise<State>;

export function AccountLinkForm({ action, heading }: { action: Action; heading: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return <main className="mx-auto max-w-md p-8"><h1 className="mb-4 text-2xl font-semibold">{heading}</h1><form action={formAction} className="space-y-4"><label className="block">Email<input autoComplete="email" className="block w-full border p-2" name="email" required type="email" /></label><Feedback state={state} /><button className="rounded bg-orange-600 px-4 py-2 text-white" disabled={pending} type="submit">Send secure link</button></form></main>;
}

export function TokenPasswordForm({ action, heading, token }: { action: Action; heading: string; token: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return <main className="mx-auto max-w-md p-8"><h1 className="mb-4 text-2xl font-semibold">{heading}</h1><form action={formAction} className="space-y-4"><input name="token" type="hidden" value={token} /><label className="block">New password<input autoComplete="new-password" className="block w-full border p-2" name="password" required type="password" /></label><label className="block">Confirm password<input autoComplete="new-password" className="block w-full border p-2" name="confirmPassword" required type="password" /></label><p className="text-sm">Use 12 or more characters with uppercase, lowercase, and a number.</p><Feedback state={state} /><button className="rounded bg-orange-600 px-4 py-2 text-white" disabled={pending || !token} type="submit">Continue</button></form></main>;
}

function Feedback({ state }: { state: State }) { return <>{state.error ? <p className="text-red-600">{state.error}</p> : null}{state.success ? <p className="text-green-700">{state.success}</p> : null}</>; }
