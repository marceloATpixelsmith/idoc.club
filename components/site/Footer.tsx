import Link from 'next/link';
import { formatOrganizationAddress, getPublicOrganizationAddress } from '@/lib/organization/settings';

export async function Footer() {
  const addressLines = formatOrganizationAddress(await getPublicOrganizationAddress());
  return (
    <footer className="mt-24 border-t border-border bg-surface/60">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 lg:grid-cols-4 lg:px-8">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img src="/idoc-logo.svg" alt="IDOC" className="h-12 w-auto" loading="lazy" />
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-muted-foreground">
            The International Dressage Officials Club unites judges, stewards and
            veterinarians in promoting the principles of horsemanship and furthering
            the education of officials worldwide.
          </p>
        </div>

        <div>
          <h4 className="eyebrow">Contact</h4>
          <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
            {addressLines.length > 0 && <li><address className="not-italic">{addressLines.map((line) => <span className="block" key={line}>{line}</span>)}</address></li>}
            <li>+32 476 914 795</li>
            <li>
              <a href="mailto:accounts@idoc.club" className="hover:text-gold">
                accounts@idoc.club
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="eyebrow">FEI Downloads</h4>
          <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
            {[
              'Dressage Rules',
              'Stewards Manual',
              'Dressage — Reports & Forms',
              'Dressage Tests',
            ].map((l) => (
              <li key={l}>
                <a
                  href="https://inside.fei.org/fei/disc/dressage"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-gold"
                >
                  {l}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="eyebrow">Useful Links</h4>
          <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
            <li>
              <a href="https://www.eurodressage.com" target="_blank" rel="noreferrer" className="hover:text-gold">
                Eurodressage
              </a>
            </li>
            <li>
              <a href="https://dressage-news.com" target="_blank" rel="noreferrer" className="hover:text-gold">
                Dressage News
              </a>
            </li>
            <li>
              <Link href="/membership" className="hover:text-gold">
                Become a Member
              </Link>
            </li>
            <li>
              <Link href="/sign-in" className="hover:text-gold">
                Member Area
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-6 text-xs uppercase tracking-[0.16em] text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <span>© {new Date().getFullYear()} IDOC — International Dressage Officials Club</span>
          <a href="https://www.facebook.com" target="_blank" rel="noreferrer" className="hover:text-gold">
            Facebook
          </a>
        </div>
      </div>
    </footer>
  );
}
