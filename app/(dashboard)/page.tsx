import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
      <h1 className="text-3xl font-medium text-foreground mb-4">IDOC</h1>
      <p className="text-muted-foreground mb-10">
        The IDOC membership platform is under active development. Sign in to an existing
        account, join as a member, or view membership pricing below.
      </p>
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <Button asChild size="lg">
          <Link href="/sign-in">Sign In</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/sign-up">Join IDOC</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/pricing">View Pricing</Link>
        </Button>
      </div>
    </main>
  );
}
