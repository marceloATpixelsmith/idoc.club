# @pixelsmith/contact-form

Shared contact-form rendering, browser/server validation, Cloudflare Turnstile protection, and Brevo transactional-email handling for Pixelsmith Next.js sites.

Read `../../AGENT_INTEGRATION.md` before integrating this package.

## Automatic package standards

Do not ask the user to choose these unless they explicitly request a different integration:

- the same field schema drives client and server validation;
- server-side validation remains authoritative;
- Cloudflare Turnstile is required on public forms;
- Turnstile is verified server-side before protected processing;
- long forms place Turnstile at the top according to the shared threshold;
- honeypot spam protection;
- field allowlisting;
- request-size protection;
- safe escaping before values enter HTML email;
- accessible labels/help/errors/status UI;
- Brevo transactional email unless the user explicitly selects another service;
- the fixed environment-variable names below.

Required env names:

```text
NEXT_PUBLIC_TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY
BREVO_API_KEY
BREVO_FROM_EMAIL
```

The names are standardized. Their secret values must never be invented or committed.

## Agent intake checklist

### Infer automatically before asking

For an existing form/site, inspect and determine when possible:

- all current fields and their order;
- field types;
- required/optional status;
- labels, placeholders, help text, and option values;
- current validation rules;
- current recipient address(es);
- email subject and sender display name;
- reply-to field;
- success/error copy;
- form layout and visual treatment;
- whether the form has uploads or unusual field semantics;
- existing Turnstile/Brevo env documentation;
- any route/action/API currently handling the form.

If the task is to preserve an existing form, reuse those established facts rather than asking the user to restate them.

### Ask the user if still unknown and required

For a new form, or when a required business decision is not established, ask:

- What fields should the form contain, in what order, and which are required?
- What should each field's label/options be?
- Which email address or addresses should receive submissions?
- What email subject should Brevo use?
- What sender display name should appear?
- Which field should be used as Reply-To, normally the submitter's email?
- What success message should the user see?
- Are there any business-specific validation rules beyond ordinary field semantics?
- If there are uploads, what file types and maximum sizes are allowed?
- If the visual layout is not established by an existing design, should fields be single-column or grouped into rows on larger screens?

Ask only for decisions that cannot be inferred safely.

### Validation rules agents may infer

When field semantics are clear, agents should apply sensible standard validation without asking unnecessary questions, such as:

- valid email syntax for email fields;
- sensible telephone input handling;
- valid URL syntax for URL fields;
- required selection for required select/radio fields;
- numeric/date constraints explicitly supplied by the form schema;
- configured file type/size rules for uploads.

If a business rule is ambiguous, ask instead of inventing it. Examples: minimum age, allowed geographic regions, eligibility rules, required consent wording, or medical/business screening logic.

### Visual configuration

The package owns consistent field/error/status structure, but the consuming site should map the form to its established brand.

Infer existing typography, colors, border/radius treatment, spacing, and button styling from the target site. For a new site with no established form design, ask only for unresolved visual decisions that materially affect the design.

### Never assume

Do not invent:

- recipient addresses;
- sender addresses or secret values;
- form fields or consent language;
- required status;
- business eligibility rules;
- file restrictions;
- legal/privacy text;
- success/error wording when content requirements are material and not supplied;
- an alternate email provider without being asked.

## Typical server route

```ts
import { createContactHandler } from '@pixelsmith/contact-form/server'
import { contactFields } from '@/lib/contact-fields'

export const POST = createContactHandler({
  fields: contactFields,
  to: 'recipient@example.com',
  subject: 'Website contact form',
  replyToField: 'email',
})
```

## Post-install verification

Verify:

- every field renders with correct label/options/order;
- required and semantic validation works client-side;
- the same invalid payload is rejected server-side;
- Turnstile prevents processing when missing/invalid/expired;
- Turnstile placement is correct for short versus long forms;
- Brevo uses `BREVO_FROM_EMAIL` and the configured recipient/subject;
- Reply-To points to the intended submitter field;
- successful submission and email-send failures are not falsely conflated;
- error messages do not leak sensitive server details;
- desktop and mobile layouts are usable and accessible;
- keyboard navigation/focus states work;
- old form handlers, duplicate Turnstile widgets, or legacy mail code are removed when replaced;
- `.env.example` documents required names without containing real secrets.
