import { Header } from '@/components/site/Header';
import { Footer } from '@/components/site/Footer';
import { getMainNavAccess } from '@/lib/auth/user-menu-access';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const navAccess = await getMainNavAccess();
  return (
    <div className="flex min-h-screen flex-col">
      <Header
        entitled={navAccess.entitled}
        memberSupport={navAccess.memberSupport}
        showAdminDashboard={navAccess.showAdminDashboard}
        supportUnread={navAccess.supportUnread}
      />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
