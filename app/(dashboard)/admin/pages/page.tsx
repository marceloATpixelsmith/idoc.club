import { ResourceListPage } from '@/components/admin/resource-list-page';

export default async function AdminPagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ResourceListPage query={await searchParams} tableType="content_pages" />;
}
