import { redirect } from 'next/navigation';

export default function RequestActivationPage() {
  redirect('/sign-in');
}
