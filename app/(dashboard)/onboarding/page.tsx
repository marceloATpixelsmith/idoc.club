import { redirect } from 'next/navigation';
import { getOwnPrivateMember } from '@/lib/membership/data-access';
import { OnboardingForm } from './form';

export default async function OnboardingPage() {
  if (await getOwnPrivateMember()) redirect('/dashboard');
  return <main className="mx-auto max-w-2xl p-8"><h1 className="mb-2 text-2xl font-semibold">Create your IDOC profile</h1><p className="mb-6">All fields are required unless marked optional.</p><OnboardingForm /></main>;
}
