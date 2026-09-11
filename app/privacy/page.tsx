export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <article className="space-y-8 text-foreground">
        <header className="space-y-3 border-b pb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">International Dressage Officials Club (IDOC)</p>
          <p className="text-sm text-muted-foreground">Last updated: 10 September 2026</p>
          <p className="max-w-3xl text-muted-foreground">
            GDPR-aligned notice for IDOC membership, website, payments, events, and communications
          </p>
        </header>

        <section className="space-y-4">
          <p>
            International Dressage Officials Club (IDOC) respects the privacy of members, applicants, event
            participants, website visitors, administrators, and other people who interact with IDOC. This
            Privacy Policy explains how IDOC processes personal data in connection with idoc.club, membership
            administration, member services, seminars and events, communications, payments, and related club
            operations.
          </p>
          <p>
            This Policy is intended to satisfy the transparency requirements of the EU General Data Protection
            Regulation (GDPR), including Articles 12, 13, and 14, to the extent those provisions apply.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">1. Data controller and contact details</h2>
          <p>
            The controller for the processing described in this Policy is International Dressage Officials Club
            (IDOC).
          </p>
          <address className="not-italic text-muted-foreground">
            <p>International Dressage Officials Club (IDOC)</p>
            <p>Van De Reydtlaan 83, 2960 Brecht, Belgium</p>
            <p>
              Email: <a className="underline underline-offset-4" href="mailto:accounts@idoc.club">accounts@idoc.club</a>
            </p>
            <p>
              Website: <a className="underline underline-offset-4" href="https://idoc.club">https://idoc.club</a>
            </p>
          </address>
          <p>
            If IDOC is required to appoint a Data Protection Officer, the applicable DPO contact details will be
            published in this Policy or otherwise provided as required by law.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">2. Personal data IDOC may collect</h2>

          <h3 className="text-xl font-semibold">2.1 Account, identity, and contact data</h3>
          <ul className="list-disc space-y-2 pl-6">
            <li>First and last name.</li>
            <li>Email address and account identifiers.</li>
            <li>Postal address, city, state or province, postal code, and country.</li>
            <li>Account, verification, and membership status.</li>
            <li>
              Authentication and security data such as password-derived credentials, verification status,
              trusted-device records, multi-factor-authentication state, recovery evidence, sessions, and
              security-event records.
            </li>
          </ul>

          <h3 className="text-xl font-semibold">2.2 Professional and membership data</h3>
          <ul className="list-disc space-y-2 pl-6">
            <li>Membership category: Judge, Steward, Judge &amp; Steward, or Veterinarian.</li>
            <li>National Federation and IDOC region, where applicable.</li>
            <li>FEI ID, where supplied.</li>
            <li>Official role, level or status and Technical Delegate status, where applicable.</li>
            <li>Membership start, paid-through, grace, expiration, suspension, renewal, and historical entitlement information.</li>
            <li>Profile-change history and authorized administrator adjustments.</li>
          </ul>

          <h3 className="text-xl font-semibold">2.3 Payment and transaction data</h3>
          <ul className="list-disc space-y-2 pl-6">
            <li>Membership and seminar amounts, currency, payment date, source, and status.</li>
            <li>Stripe customer, subscription, checkout, invoice, payment, refund, dispute, and related identifiers or summarized billing information.</li>
            <li>Manual-payment references for approved non-Stripe methods where used.</li>
            <li>Refund reason, amount, timestamp, authorization, and reconciliation records.</li>
          </ul>
          <p>
            IDOC does not intend to store full payment-card numbers or card security codes; those details are
            handled by Stripe or another authorized payment provider.
          </p>

          <h3 className="text-xl font-semibold">2.4 Event, support, and communications data</h3>
          <ul className="list-disc space-y-2 pl-6">
            <li>Seminar or event registration, attendance, eligibility, payment, cancellation, wait-list, and related administrative data.</li>
            <li>Support, membership, billing, and event communications with IDOC.</li>
            <li>Information you voluntarily provide when contacting IDOC.</li>
          </ul>

          <h3 className="text-xl font-semibold">2.5 Website, device, security, and log data</h3>
          <ul className="list-disc space-y-2 pl-6">
            <li>IP address, browser and device information, request timestamps, and requested pages or endpoints.</li>
            <li>Cookies, session identifiers, anti-bot or security signals, rate-limit information, and similar technical data.</li>
            <li>Application, server, audit, security, and error logs.</li>
            <li>Information used to investigate fraud, abuse, account compromise, failed or duplicate payments, and technical faults.</li>
          </ul>

          <h3 className="text-xl font-semibold">2.6 Marketing preferences</h3>
          <p>
            IDOC may record whether you affirmatively choose to receive optional updates about IDOC events,
            workshops, certifications, or similar activities, together with subscription and opt-out evidence
            needed to honor that choice.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">3. Sources of personal data</h2>
          <p>
            IDOC obtains personal data directly from you when you create or use an account, complete onboarding,
            update your profile, pay, register for an event, contact IDOC, or choose communication preferences.
            IDOC may also obtain personal data indirectly from authorized administrators, legacy membership
            records, Stripe or other payment providers, authentication/security providers, hosting and email
            providers, National Federations, the FEI, event partners, or other relevant sources where there is a
            lawful basis.
          </p>
          <p>
            Where Article 14 GDPR applies because personal data was not obtained directly from you, IDOC will
            provide the required information within the applicable Article 14 timeframe: generally within one
            month, at the time of the first communication with you if earlier, or before the first disclosure to
            another recipient if earlier, unless a lawful exception applies or you already have the information.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">4. Purposes, legal bases, and legitimate interests</h2>
          <p>
            IDOC does not rely on a single legal basis for all processing. The basis depends on the purpose. In
            particular, acknowledging this Privacy Policy does not itself create consent for processing that is
            necessary to provide membership or comply with law.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="p-3 font-semibold">Purpose</th>
                  <th className="p-3 font-semibold">Typical legal basis</th>
                  <th className="p-3 font-semibold">Legitimate interest where relied upon</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="p-3">Create and authenticate an account; process onboarding</td>
                  <td className="p-3">Contract / steps before contract; legitimate interests</td>
                  <td className="p-3">Securely operating accounts, preventing abuse, and maintaining reliable identity records</td>
                </tr>
                <tr className="border-b">
                  <td className="p-3">Administer membership, entitlement, professional profile, renewals, and member access</td>
                  <td className="p-3">Contract; legitimate interests; legal obligations where applicable</td>
                  <td className="p-3">Accurate club administration, member eligibility, continuity of records, and prevention of entitlement errors</td>
                </tr>
                <tr className="border-b">
                  <td className="p-3">Process payments, subscriptions, refunds, disputes, and reconciliation</td>
                  <td className="p-3">Contract; legal obligation; legitimate interests</td>
                  <td className="p-3">Collecting amounts due, preventing duplicate or fraudulent transactions, maintaining accurate accounting and membership records</td>
                </tr>
                <tr className="border-b">
                  <td className="p-3">Operate seminars, events, applications, and wait lists</td>
                  <td className="p-3">Contract / steps before contract; legitimate interests</td>
                  <td className="p-3">Efficient event administration, eligibility management, participant communications, and capacity planning</td>
                </tr>
                <tr className="border-b">
                  <td className="p-3">Provide the paid member directory and professional networking functions</td>
                  <td className="p-3">Contract; legitimate interests</td>
                  <td className="p-3">Enabling legitimate professional networking and club functions among current eligible members</td>
                </tr>
                <tr className="border-b">
                  <td className="p-3">Send account, security, membership, payment, renewal, and event-service messages</td>
                  <td className="p-3">Contract; legal obligation; legitimate interests</td>
                  <td className="p-3">Keeping members informed about services, security, payments, and membership standing</td>
                </tr>
                <tr className="border-b">
                  <td className="p-3">Send optional promotional updates</td>
                  <td className="p-3">Consent, where consent is the chosen basis</td>
                  <td className="p-3">Not applicable when processing is based on consent</td>
                </tr>
                <tr className="border-b">
                  <td className="p-3">Protect systems, prevent abuse, investigate incidents, and maintain audit evidence</td>
                  <td className="p-3">Legitimate interests; legal obligation where applicable</td>
                  <td className="p-3">Cybersecurity, fraud prevention, accountability, service integrity, and defense of legal claims</td>
                </tr>
                <tr>
                  <td className="p-3">Comply with accounting, tax, regulatory, legal, or dispute obligations</td>
                  <td className="p-3">Legal obligation; legitimate interests; legal claims</td>
                  <td className="p-3">Compliance, evidence preservation, dispute resolution, and protection of legal rights</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">5. Required versus optional information and consequences of not providing it</h2>
          <p>
            Certain data is required to create and administer an IDOC account or membership. Required data
            includes the identity, contact, membership-classification, and other profile fields designated as
            required for the selected membership category, plus information necessary to authenticate the
            account and record payment or another authorized entitlement.
          </p>
          <p>
            If you do not provide required data, IDOC may be unable to create the account, complete onboarding,
            verify eligibility, process payment, activate or renew membership, provide member-only services, or
            register you for a service that requires that information.
          </p>
          <p>
            Fields identified as optional may be left blank without preventing membership unless the field later
            becomes necessary for a service you specifically request. Optional promotional marketing consent is
            not required for membership and must not be a condition of receiving the core service.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">6. Essential communications and optional marketing</h2>
          <p>
            IDOC may send operational communications necessary to administer your account or membership,
            including verification, password and security notices, membership status, payment confirmations,
            failed-payment notices, renewal or expiration reminders, refunds, event administration, and
            important service notices. These are not optional marketing communications.
          </p>
          <p>
            Optional marketing about events, workshops, certifications, or similar activities is separate. Where
            consent is relied upon, the choice must be freely given, specific, informed, unambiguous, and made by
            a clear affirmative action. IDOC will not treat silence, inactivity, or a pre-selected marketing
            checkbox as consent. You may withdraw marketing consent at any time without affecting membership or
            essential service messages.
          </p>
          <p>
            IDOC should retain evidence of the marketing-consent event, including the account, consent status,
            date/time, source, and applicable wording or policy version, so that the choice can be demonstrated
            and later honored or withdrawn.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">7. Member directory and public aggregate information</h2>
          <p>
            For currently entitled members, IDOC may provide a limited professional directory to other eligible
            members. It may include first and last name, country, professional role and level, National
            Federation, and IDOC region. It is not intended to expose email addresses, exact street addresses,
            payment data, authentication data, or raw internal database identifiers.
          </p>
          <p>
            Where directory processing relies on legitimate interests, members retain the right to object under
            Article 21 GDPR. IDOC will assess an objection in accordance with applicable law and will cease
            processing where required unless compelling legitimate grounds or legal-claims grounds permit
            continuation.
          </p>
          <p>
            IDOC may publish aggregate membership counts designed not to identify individual members. Public
            aggregate features should apply appropriate minimum thresholds and data-minimization safeguards.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">8. Recipients and categories of recipients</h2>
          <p>
            IDOC may disclose personal data only where reasonably necessary for the purposes described in this
            Policy, including to authorized IDOC administrators and service personnel; Stripe and other payment
            providers; hosting, deployment, database, email, security, anti-abuse, logging, monitoring, and
            technical providers; relevant event organizers, instructors, venues, National Federations, the FEI,
            or other bodies where necessary and lawful; professional advisers; public authorities or courts
            where legally required; and a lawful successor organization in connection with an organizational
            transfer.
          </p>
          <p>IDOC does not sell personal data to advertisers.</p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">9. International transfers</h2>
          <p>
            Because IDOC serves an international membership and uses external service providers, personal data
            may be processed outside Belgium or the European Economic Area. Where Chapter V GDPR applies, IDOC
            will use a lawful transfer mechanism, such as an adequacy decision, Standard Contractual Clauses, or
            another legally recognized safeguard, and supplementary measures where required.
          </p>
          <p>
            You may contact IDOC using the details in Section 1 to request information about the transfer
            mechanism applicable to your data and, where required by law, obtain a copy of or access to the
            relevant safeguards, subject to lawful redactions for confidential or security-sensitive
            information.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">10. Data retention</h2>
          <p>
            IDOC retains personal data only for as long as reasonably necessary for the purposes for which it
            was collected, including membership and event administration, accurate payment and entitlement
            history, legal and accounting obligations, security, dispute resolution, and legal claims.
          </p>
          <p>
            Retention is determined by data category and purpose rather than a single universal period.
            Financial, refund, audit, and membership-history records may need to be retained after membership
            ends; temporary verification challenges, expired sessions, failed signup attempts, transient logs,
            and migration files should be deleted or anonymized sooner when no longer necessary.
          </p>
          <p>
            IDOC will maintain documented retention criteria or schedules for material data categories and
            implement deletion, anonymization, or archival processes so data is not kept indefinitely merely
            because storage is available.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">11. Security and data protection by design</h2>
          <p>
            IDOC uses technical and organizational safeguards designed to protect personal data against
            unauthorized access, alteration, disclosure, loss, or misuse. Safeguards may include server-side
            authorization, membership access controls, encrypted network connections, password hashing, email
            verification, multi-factor authentication for privileged accounts, purpose-bound step-up
            authentication, secure cookies, anti-bot protections, rate limiting, validation, append-only audit
            evidence, restricted database access, verified payment webhooks, backups, and monitoring.
          </p>
          <p>
            Access should follow least-privilege principles, and application functions should collect, expose,
            and log only the personal data reasonably necessary for their stated purpose.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">12. Cookies and similar technologies</h2>
          <p>
            IDOC may use cookies and similar technologies that are strictly necessary to authenticate users,
            maintain secure sessions, remember permitted device state, protect forms and login flows, prevent
            abuse, and operate requested website features.
          </p>
          <p>
            If IDOC introduces non-essential analytics, advertising, profiling, or similar tracking technologies
            for which consent is required under applicable law, those technologies must remain disabled until
            the user has made the required choice, and the site must provide a mechanism to later withdraw or
            change that choice. The cookie interface must not use pre-selected consent for non-essential
            categories.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">13. Your GDPR rights</h2>
          <p>Subject to applicable conditions and exceptions, you may have the right to:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>Access your personal data.</li>
            <li>Correct inaccurate data.</li>
            <li>Request erasure.</li>
            <li>Request restriction of processing.</li>
            <li>Object to processing based on legitimate interests.</li>
            <li>Object at any time to direct marketing.</li>
            <li>Receive qualifying data in a portable format.</li>
            <li>Withdraw consent where consent is relied upon.</li>
            <li>Lodge a complaint with a competent supervisory authority.</li>
          </ul>
          <p>
            IDOC may verify identity before acting on a request. Rights are not absolute; for example, IDOC may
            retain financial, audit, security, or legal records where another lawful basis requires or permits
            continued retention.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">14. Handling rights requests</h2>
          <p>
            IDOC will provide a practical method for submitting privacy-rights requests. In accordance with
            Article 12 GDPR, IDOC will respond without undue delay and in principle within one month of receiving
            a valid request. Where permitted because of complexity or number of requests, that period may be
            extended by up to two additional months, with notice of the extension and reasons within the initial
            one-month period.
          </p>
          <p>
            If IDOC does not act on a request, it will provide the reasons and information about the right to
            complain to a supervisory authority and seek a judicial remedy, as required by applicable law.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">15. Automated decision-making and profiling</h2>
          <p>
            IDOC does not intend to make decisions producing legal or similarly significant effects about
            members solely by automated processing without appropriate human involvement, except where lawful
            and properly disclosed. Automated controls may be used for security, anti-abuse, rate limiting,
            payment reconciliation, account routing, and membership-entitlement enforcement. If Article
            22-significant automated decision-making is introduced, IDOC will provide the additional information
            and safeguards required by law before using it.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">16. Personal-data breaches</h2>
          <p>
            IDOC maintains incident-response processes for security events involving personal data. Where a
            personal-data breach triggers GDPR notification duties, IDOC will notify the competent supervisory
            authority and, where required because of high risk, affected individuals within the applicable legal
            timeframes.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">17. Children</h2>
          <p>
            IDOC membership and professional services are directed to dressage officials and related
            professionals rather than children. IDOC does not knowingly design the membership service for
            children. If data from a child is processed in circumstances requiring parental authorization or
            another legal basis that is absent, IDOC will take appropriate steps consistent with applicable law.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">18. Third-party websites and independent controllers</h2>
          <p>
            The website may link to the FEI, National Federations, event platforms, venues, payment services,
            publications, or other third parties. Those organizations may act as independent controllers for
            data they collect directly from you. Their privacy practices are governed by their own notices.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">19. Changes to this Privacy Policy</h2>
          <p>
            IDOC may update this Policy when services, providers, legal obligations, or processing activities
            change. The current version will be posted with its last-updated date. If a material change makes
            information previously provided obsolete or incomplete, IDOC will provide additional notice where
            required by the GDPR.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">20. Complaints and supervisory authority</h2>
          <p>
            If you have a concern about IDOC handling of personal data, you may contact IDOC using the details in
            Section 1. You also have the right to lodge a complaint with the Belgian Data Protection Authority
            or another competent EEA supervisory authority, particularly in the country of habitual residence,
            place of work, or place of the alleged infringement.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">21. Contact</h2>
          <address className="not-italic text-muted-foreground">
            <p>International Dressage Officials Club (IDOC)</p>
            <p>Van De Reydtlaan 83, 2960 Brecht, Belgium</p>
            <p>
              Email: <a className="underline underline-offset-4" href="mailto:accounts@idoc.club">accounts@idoc.club</a>
            </p>
            <p>
              Website: <a className="underline underline-offset-4" href="https://idoc.club">https://idoc.club</a>
            </p>
          </address>
        </section>
      </article>
    </main>
  );
}
