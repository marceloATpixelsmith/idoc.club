import { redirect } from 'next/navigation';

export default function LegacyNewsNewRoute() {
  redirect('/admin/news?new=1');
}
