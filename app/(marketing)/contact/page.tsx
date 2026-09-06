import type { Metadata } from 'next';
import { PageHeader } from '@/components/site/PageHeader';

export const metadata: Metadata = {
  title: 'Contact IDOC',
  description:
    'Contact the International Dressage Officials Club secretariat in Brecht, Belgium for membership, seminars and press enquiries.',
  openGraph: {
    title: 'Contact IDOC',
    description: 'Reach the IDOC secretariat for membership, seminar and press enquiries.',
  },
};

export default function ContactPage() {
  return (
    <>
      <PageHeader
        eyebrow="Get in touch"
        title="Contact"
        intro="The IDOC secretariat answers membership, seminar and press enquiries."
      />
      <section className="mx-auto grid max-w-5xl gap-12 px-5 py-20 sm:grid-cols-2 lg:px-8">
        <div>
          <h2 className="rule-gold text-2xl">Secretariat</h2>
          <address className="mt-6 space-y-1 text-sm not-italic leading-relaxed text-muted-foreground">
            <p>Van De Reydtlaan 83</p>
            <p>2960 Brecht, Belgium</p>
            <p>+32 476 914 795</p>
            <p>
              <a href="mailto:accounts@idoc.club" className="text-gold hover:opacity-80">
                accounts@idoc.club
              </a>
            </p>
          </address>
        </div>
        <div>
          <h2 className="rule-gold text-2xl">Membership & dues</h2>
          <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
            For applications, invoices and changes of officiating status, email the
            secretariat with your name, nation and current FEI or national level.
          </p>
        </div>
      </section>
    </>
  );
}
