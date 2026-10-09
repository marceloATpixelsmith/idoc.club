import { redirect } from 'next/navigation';

export default async function LegacySeminarEditRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect('/admin/seminars?seminarId=' + encodeURIComponent(id));
}
