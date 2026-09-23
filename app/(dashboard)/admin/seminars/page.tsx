import { ResourceListPage } from '@/components/admin/resource-list-page';

export default async function AdminSeminarsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ResourceListPage query={await searchParams} tableType="seminars" />;
}
