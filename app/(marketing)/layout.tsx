import { Header } from '@/components/site/Header';
import { Footer } from '@/components/site/Footer';
import { mayShowAdminDashboard } from '@/lib/auth/user-menu-access';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header showAdminDashboard={await mayShowAdminDashboard()} />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
