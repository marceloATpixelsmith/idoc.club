import { redirect } from 'next/navigation';

export default async function LegacyNewsEditRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect('/admin/news?articleId=' + encodeURIComponent(id));
}
