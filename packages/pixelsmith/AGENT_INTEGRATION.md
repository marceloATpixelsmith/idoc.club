# Agent Integration Rules

These rules apply whenever an AI coding agent creates or modifies a site that uses, should use, or could reasonably benefit from a package in `pixelsmith-website-core`.

The goal is to make shared behavior automatic without causing agents to invent site-specific design, content, routing, credentials, or business rules.

## Required workflow before implementation

1. Inspect the target repository first. Read its package manager, framework/version, existing header/menu, localization setup, forms, store integration, routes, environment examples, design tokens, and relevant components.
2. Identify which Pixelsmith core packages are applicable.
3. Read this file and every applicable package's README and agent-intake document before changing implementation.
4. Separate configuration into three groups:
   - facts already established by the target repository or the user's prompt;
   - values standardized by the core package and therefore not questions for the user;
   - unresolved site-specific decisions that genuinely require user input.
5. Ask the user only for unresolved required decisions. Group related questions together when they can be answered on one screen/message.
6. Do not start a design-affecting or routing-affecting integration while a required unresolved choice remains.
7. When modifying an existing site, preserve established branding, URLs, content, and intended behavior unless the user explicitly asks to change them.

## Do not ask for standardized decisions

If the core package already specifies a value or behavior, use it without asking the user to choose again. Examples include:

- Turnstile env names;
- Brevo env names;
- Ecwid credential env names;
- the shared language-toggle interaction;
- the canonical site-menu interaction model;
- server-side form revalidation;
- recent-search persistence behavior;
- hiding duplicate Ecwid inline search UI;
- accessibility and responsive safeguards built into the package.

Agents should not turn package standards into unnecessary questionnaires.

## What must be inferred before asking

Before asking the user, inspect the existing site for evidence such as:

- current logo and brand colors;
- current menu items and destinations;
- current language(s) and default language;
- established URLs that must remain stable;
- existing contact-form fields and recipients;
- existing Ecwid store ID, routes, category configuration, and locale behavior;
- existing layout width, spacing, typography, and component treatment;
- `.env.example` names and documented deployment settings.

If a value is unambiguous in the current site and the task is to preserve the site, reuse it rather than asking the user to restate it.

## What must never be invented

Do not invent:

- credentials, secrets, environment-variable values, store IDs, webhook secrets, or recipient addresses;
- category IDs, product IDs, route words, URLs, menu destinations, or external links;
- translation languages or default locale;
- form fields, required status, business validation rules, recipients, or email subjects;
- store-specific search terms, category exclusions, category ordering, notices, or policies;
- brand colors, logos, typography, imagery, spacing, or layout choices when they are not established;
- a visual treatment merely because a canonical reference site uses it when the package explicitly leaves that treatment configurable.

Canonical sites are implementation references, not sources of site-specific content or identifiers.

## How to ask for missing information

Ask concrete implementation questions, not abstract preference questions. Prefer choices that map directly to configuration.

Good:

- `What should the store base URL be: /shop, /store, /tienda, or another path?`
- `Should the Ecwid megamenu use the site's existing header colors and typography, or do you want a different panel treatment?`
- `Which email address should receive this form?`

Avoid:

- `How do you want the site to feel?`
- `What style do you like?`
- asking for information that is already visible in the repository.

When several unresolved inputs belong to one feature, ask them together rather than one microscopic question at a time unless the user has specifically requested single-step interaction.

## Existing sites versus new sites

### Existing site

Default to preservation. Infer established design/configuration from the current implementation and ask only where the integration introduces a genuinely new decision.

### New site

The agent must gather the package's required site-specific inputs before implementation. If the user has supplied a design, mockup, existing site reference, or brand guide, derive as much as possible from that source first.

## Visual configuration rules

Shared packages own common structure, responsive behavior, accessibility, and interaction patterns. Site-level branding remains configurable where documented.

When a package exposes visual configuration:

- match the target site's established design tokens when modifying an existing site;
- ask for missing visual decisions on a new site when no design reference establishes them;
- do not fork shared package code just to change brand colors or ordinary site-level presentation;
- use documented CSS variables, props, slots, and extension points;
- if a requested design cannot be represented by the package's intended configuration surface, improve the shared package rather than creating a private copy in one site when the behavior should remain reusable.

## Environment variables

The agent must distinguish env variable names from env variable values.

Names standardized by core packages should be wired automatically. Values are deployment secrets/configuration and must never be invented.

If a required env value is not available to the agent, finish all code that can safely be completed and provide the user with the exact missing variable names and what each value must contain.

## Post-install verification

Every package integration must be verified against its package documentation. At minimum:

- typecheck and build when scripts exist;
- test relevant desktop and mobile layouts;
- verify keyboard/focus interaction for interactive UI;
- verify existing URLs continue to work when preserving a site;
- verify no duplicate legacy implementation remains active;
- verify required env names are documented in the target repo without committing secret values;
- verify package styling inherits the intended site brand;
- verify no canonical-reference site IDs, text, URLs, or secrets were copied accidentally.

For Ecwid, forms, and localization, also perform the package-specific checks listed in their package documents.

## Package-specific intake documents

Before using a package, read:

- `packages/localization/README.md`
- `packages/site-menu/README.md`
- `packages/ecwid-store/README.md`
- `packages/ecwid-store/AGENT_INTAKE.md`
- `packages/contact-form/README.md`

These documents define what is automatic, what should be inferred, what must be asked if unknown, and what must be verified after installation.
