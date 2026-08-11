# @pixelsmith/localization

Shared localization state, persistence, helpers, and language-switch UI for Pixelsmith Next.js sites. Translated content stays in the consuming site.

Read `../../AGENT_INTEGRATION.md` before integrating this package.

## Automatic package standards

Do not ask the user to choose these unless they explicitly want to change the shared standard:

- one shared language state/provider rather than scattered local toggles;
- cookie persistence;
- browser-language detection where applicable;
- `<html lang>` synchronization;
- shared `LanguageToggle` behavior;
- 32px current-language bubble;
- alternate-language bubble opening downward in desktop/header use and to the right when used inside the mobile menu;
- translated site content remains in the site repository;
- locale mapping for commerce integrations is configuration, not hard-coded package behavior.

## Agent intake checklist

### Infer automatically before asking

Inspect the target site and determine when possible:

- whether it is currently multilingual;
- which languages already exist;
- the current/default language;
- whether URLs are language-neutral or locale-prefixed;
- existing translated labels/content structure;
- whether there is an existing language cookie/local-storage mechanism that should be migrated;
- whether an Ecwid or other embedded integration currently needs a locale mapping;
- whether changing language currently requires a reload for an embedded service.

For an existing site, preserve established language behavior and content unless the task says otherwise.

### Ask the user if still unknown and required

For a new multilingual site, or when the repository does not establish the answer, ask:

- Which languages should the site support?
- Which language is the default?
- What short labels should appear in the UI, if they are not obvious from the language codes?
- Should the language choice persist across visits? Default answer is yes unless the user specifies otherwise.
- If routes are localized, what URL strategy should be used?
- If an embedded store/service needs explicit locale codes, what mapping should be used when it cannot be inferred?

Do not ask about any of these when the existing site already answers them unambiguously.

### Never assume

Do not invent:

- supported languages;
- default locale;
- translated copy;
- locale-prefixed URL structures;
- Ecwid locale mappings for an unknown language;
- a reload requirement that is not needed by the integration.

## Typical configuration

```tsx
import {
  LanguageProvider,
  LanguageToggle,
  getCommerceLocale,
} from '@pixelsmith/localization'
import '@pixelsmith/localization/styles.css'

const localization = {
  locales: [
    { code: 'es', label: 'Español', shortLabel: 'ES', htmlLang: 'es', commerceLocale: 'es_MX' },
    { code: 'en', label: 'English', shortLabel: 'EN', htmlLang: 'en', commerceLocale: 'en' },
  ],
  defaultLocale: 'es',
  cookieName: 'site_lang',
} as const
```

## Visual configuration

The language-switch interaction is shared. The consuming site should integrate it into the site's established header/menu styling rather than forking the component.

When implementing a new site with no established visual system, ask only for genuinely missing brand decisions such as foreground/background/accent colors or placement if the broader header design has not already established them.

## Post-install verification

Verify:

- language persists after navigation and reload;
- `<html lang>` matches the active language;
- all affected site labels/content switch together;
- desktop and mobile language controls remain usable by pointer and keyboard;
- no old competing language-state mechanism remains active;
- existing localized URLs remain stable if preserving an existing site;
- Ecwid/embedded integrations receive the intended locale;
- no translated content was moved into the package.
