import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export function BackLink({
  children,
  className,
  href,
}: {
  children: React.ReactNode;
  className?: string;
  href: string;
}) {
  return (
    <div className={cn('py-6', className)}>
      <Link className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground" href={href}>
        <ArrowLeft aria-hidden className="h-4 w-4 shrink-0" />
        <span>{children}</span>
      </Link>
    </div>
  );
}
