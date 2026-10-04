import { redirect } from 'next/navigation';

export default async function LegacyMemberSupportThread({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  redirect(`/contact/${encodeURIComponent(publicId)}`);
}
