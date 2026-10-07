import type { Metadata } from 'next';
import { CountryFlag } from '@/components/ui/country-flag';
import { PageHeader } from '@/components/site/PageHeader';
import { listPublicBoardMembers } from '@/lib/directory/board-members';
import { countryNameForCode } from '@/lib/membership/countries';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'IDOC Board Members — Officers & Regional Representatives',
  description:
    "Meet the IDOC board: president, vice-presidents, secretary, treasurer, regional representatives, steward and para dressage representatives.",
  openGraph: {
    title: 'IDOC Board Members',
    description:
      'The officers and regional representatives of the International Dressage Officials Club.',
  },
};

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="currentColor">
      <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" />
    </svg>
  );
}

export default async function BoardMembersPage() {
  const boardMembers = await listPublicBoardMembers();
  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Board Members"
        intro="The IDOC board brings together judges, stewards and para dressage officials from every region of the sport."
      />

      <section className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        {boardMembers.length === 0 ? (
          <p className="text-muted-foreground">Board member information is being updated.</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {boardMembers.map((member) => (
              <article key={`${member.firstName}-${member.lastName}`} className="card-midnight overflow-hidden">
                <img
                  src={member.boardPhotoUrl}
                  alt={`Portrait of ${member.firstName} ${member.lastName}`}
                  loading="lazy"
                  className="aspect-[4/5] w-full object-cover object-top"
                />
                <div className="p-6">
                  <p className="text-xs uppercase tracking-[0.18em] text-gold">{member.boardTitle}</p>
                  <h2 className="mt-3 font-display text-2xl leading-snug">
                    {member.firstName} {member.lastName}
                  </h2>
                  {member.countryCode ? (
                    <p className="mt-1 inline-flex items-center gap-2 text-sm text-muted-foreground">
                      {countryNameForCode(member.countryCode)}
                      <CountryFlag code={member.countryCode} className="size-4" />
                    </p>
                  ) : null}
                  {member.boardSubtitle ? <p className="mt-3 text-sm text-muted-foreground">{member.boardSubtitle}</p> : null}
                  {member.officialDetails.length > 0 ? (
                    <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
                      {member.officialDetails.map((detail) => <li key={detail}>{detail}</li>)}
                    </ul>
                  ) : null}
                  {member.boardFacebookUrl ? (
                    <a
                      href={member.boardFacebookUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${member.firstName} ${member.lastName} on Facebook`}
                      className="mt-5 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-gold/50 hover:text-gold"
                    >
                      <FacebookIcon />
                      Facebook
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
