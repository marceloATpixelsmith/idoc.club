import type { ReactNode } from 'react';

export function PageHeader({
  action,
  eyebrow,
  title,
  intro,
}: {
  action?: ReactNode;
  eyebrow: string;
  title: string;
  intro?: string;
}) {
  return (
    <section className="border-b border-border bg-surface/40">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-12 md:flex-row md:items-center md:justify-between lg:px-8">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-4 text-5xl leading-tight lg:text-6xl">{title}</h1>
          {intro ? <p className="mt-6 max-w-2xl leading-relaxed text-muted-foreground">{intro}</p> : null}
        </div>
        {action ? <div className="shrink-0 md:pl-8">{action}</div> : null}
      </div>
    </section>
  );
}
