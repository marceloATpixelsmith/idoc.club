export function PageHeader({
  eyebrow,
  title,
  intro,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
}) {
  return (
    <section className="border-b border-border bg-surface/40">
      <div className="mx-auto max-w-7xl px-5 py-12 lg:px-8">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-4 text-5xl leading-tight lg:text-6xl">{title}</h1>
        {intro && (
          <p className="mt-6 max-w-2xl leading-relaxed text-muted-foreground">{intro}</p>
        )}
      </div>
    </section>
  );
}
