import { ResourceListPage } from '@/components/admin/resource-list-page';
import { AdminSeminarDrawer } from './seminar-drawer';

export default async function AdminSeminarsPage({ searchParams }: { searchParams: Promise<{ new?: string | string[]; seminarId?: string | string[] }> }) {
  const params = await searchParams;
  const seminarId = Array.isArray(params.seminarId) ? params.seminarId[0] : params.seminarId;
  const isNew = (Array.isArray(params.new) ? params.new[0] : params.new) === '1';
  return (
    <>
      <ResourceListPage tableType="seminars" />
      {isNew ? <AdminSeminarDrawer isNew /> : seminarId ? <AdminSeminarDrawer seminarId={seminarId} /> : null}
    </>
  );
}
