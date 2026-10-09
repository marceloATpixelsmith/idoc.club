import { MemberSupportThread } from '@/components/support/member-support-thread';

export default async function ContactSupportThread({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  return <MemberSupportThread publicId={publicId} />;
}
