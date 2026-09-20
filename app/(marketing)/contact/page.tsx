import type { Metadata } from 'next';
import { PageHeader } from '@/components/site/PageHeader';
import { formatOrganizationAddress, getPublicOrganizationAddress } from '@/lib/organization/settings';
import { ContactForm } from './contact-form';

export const metadata: Metadata = {
  title: 'Contact IDOC',
  description:
    'Contact the International Dressage Officials Club (IDOC) in Brecht, Belgium with any question or enquiry.',
  openGraph: {
    title: 'Contact IDOC',
    description: 'Reach IDOC with any question or enquiry.',
  },
};

export default async function ContactPage() {
  const addressLines = formatOrganizationAddress(await getPublicOrganizationAddress());
  return (
    <>
      <PageHeader
        eyebrow="Get in touch"
        title="Contact"
        intro="Have a question, or want to learn more about IDOC? Send us a message and we'll get back to you."
      />
      <section className="mx-auto grid max-w-7xl gap-12 px-5 py-20 lg:grid-cols-2 lg:px-8">
        <div>
          <h2 className="rule-gold text-2xl">Contact details</h2>
          <address className="mt-6 space-y-1 text-base not-italic leading-relaxed text-muted-foreground">
            {addressLines.map((line) => <p key={line}>{line}</p>)}
            <p className="mt-4 text-lg font-medium text-foreground">
              <a href="tel:+32476914795" className="hover:text-gold">
                +32 476 914 795
              </a>
            </p>
            <p className="text-lg font-medium">
              <a href="mailto:accounts@idoc.club" className="text-gold hover:opacity-80">
                accounts@idoc.club
              </a>
            </p>
          </address>
        </div>
        <div>
          <h2 className="rule-gold text-2xl">Send a message</h2>
          <div className="mt-6">
            <ContactForm />
          </div>
        </div>
      </section>
    </>
  );
}
