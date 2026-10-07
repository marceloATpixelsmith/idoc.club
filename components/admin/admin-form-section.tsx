import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function AdminFormSection({ children, description, title }: { children: ReactNode; description?: string; title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-bold uppercase tracking-wider text-gold">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-6 [&>div.grid]:gap-6" data-idoc-admin-form-section>{children}</CardContent>
    </Card>
  );
}
