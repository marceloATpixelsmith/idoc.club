import { redirect } from 'next/navigation';

export default async function LegacySupportDetailRoute({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  redirect('/admin/support?supportId=' + encodeURIComponent(publicId));
}
