import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOwnPrivateMember, requireAccountAccess } from '@/lib/membership/data-access';
import { isPrivilegedActor } from '@/lib/membership/account-access';
import { isEntitled } from '@/lib/membership/entitlement';
import { getUser } from '@/lib/db/queries';
import { HOW_TO_SECTIONS, type HowToSection } from '@/lib/how-to/guide';

export const metadata: Metadata = { title: 'How to Use idoc.club — IDOC' };

function VideoPanel({ section }: { section: HowToSection }) {
  if (!section.videoSrc) {
    return (
      <div className="flex aspect-video items-center justify-center border border-dashed border-border bg-background px-6 text-center text-sm text-muted-foreground">
        The video for {section.title} is coming soon. The steps below cover the same ground.
      </div>
    );
  }
  return (
    // Same-origin file: the site's content security policy allows media only from our own origin.
    <video aria-label={`How to: ${section.title}`} className="aspect-video w-full border border-border bg-black" controls playsInline preload="metadata" src={section.videoSrc} />
  );
}

export default async function HowToUsePage() {
  // Same gate as My Profile: members who have not finished onboarding or paid are held on My Membership.
  const user = await getUser();
  if (!user || user.accountState === 'onboarding') redirect('/dashboard');
  const actor = await requireAccountAccess('profile');
  const privileged = isPrivilegedActor(actor);
  const member = await getOwnPrivateMember();
  if (!member && !privileged) redirect('/dashboard');
  if (member && !privileged && !isEntitled(member.entitlement, new Date().toISOString().slice(0, 10))) redirect('/dashboard');

  return (
    <section className="px-5 py-4 lg:px-8 lg:py-8">
      <h1 className="text-2xl font-medium">How to Use idoc.club</h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">Short videos and step-by-step instructions for the main areas of the site.</p>
      <nav aria-label="How-to topics" className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-b border-border pb-4">
        {HOW_TO_SECTIONS.map((section) => (
          <a className="text-sm underline-offset-4 hover:text-gold hover:underline" href={`#${section.id}`} key={section.id}>{section.title}</a>
        ))}
      </nav>
      <div className="mt-8 space-y-14">
        {HOW_TO_SECTIONS.map((section) => (
          <article aria-labelledby={`${section.id}-heading`} className="scroll-mt-28" id={section.id} key={section.id}>
            <h2 className="rule-gold text-xl" id={`${section.id}-heading`}>{section.title}</h2>
            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              <VideoPanel section={section} />
              <div>
                {section.summary.map((paragraph) => <p className="mb-3 text-sm leading-relaxed text-muted-foreground" key={paragraph}>{paragraph}</p>)}
                <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
                  {section.steps.map((step) => <li key={step}>{step}</li>)}
                </ol>
                <Link className="mt-5 inline-block text-sm text-gold underline underline-offset-4" href={section.featureHref}>{section.featureLabel}</Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
