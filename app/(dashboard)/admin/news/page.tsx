import { ResourceListPage } from '@/components/admin/resource-list-page';
import { AdminNewsDrawer } from './news-drawer';

export default async function AdminNewsPage({ searchParams }: { searchParams: Promise<{ articleId?: string; new?: string }> }) {
  const params = await searchParams;
  return (
    <>
      <ResourceListPage tableType="news" />
      {params.new === '1' ? <AdminNewsDrawer isNew /> : params.articleId ? <AdminNewsDrawer articleId={params.articleId} /> : null}
    </>
  );
}
