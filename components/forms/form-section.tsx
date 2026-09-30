import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Shared responsive section primitive for authenticated dashboard and administration forms. */
export function FormSection({ children, className, title }: { children: React.ReactNode; className?: string; title: string }) {
  return <Card className={className}><CardHeader><CardTitle className="text-lg font-bold uppercase tracking-wider text-gold">{title}</CardTitle></CardHeader><CardContent>{children}</CardContent></Card>;
}

export function FormGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid gap-4 sm:grid-cols-2', className)}>{children}</div>;
}
