import { redirect } from 'next/navigation';

export default function LegacySeminarNewRoute() {
  redirect('/admin/seminars?new=1');
}
