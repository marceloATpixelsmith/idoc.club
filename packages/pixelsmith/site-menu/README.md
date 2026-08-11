# @pixelsmith/site-menu

Shared desktop and mobile navigation system for Pixelsmith Next.js sites. The canonical visual/interaction reference is `ameyalli.space`.

Read `../../AGENT_INTEGRATION.md` before integrating this package.

## Automatic package standards

Do not ask the user to choose these unless they explicitly request a different shared standard:

- one coherent desktop + mobile navigation system;
- fixed-header behavior;
- translucent/blurred scrolled/open state;
- desktop uppercase tracked navigation treatment;
- active-item accent treatment;
- animated underline for active/hover/focus;
- subtle hovered-item scale-up;
- dimming of non-hovered desktop items;
- mobile hamburger-to-close transition;
- expandable mobile panel below the header;
- mobile separators and tracked uppercase labels;
- automatic close after navigation;
- reduced-motion support;
- responsive behavior and accessibility safeguards.

Each site still provides its own brand, colors, logo, labels, destinations, utilities, and any site-specific extras.

## Agent intake checklist

### Infer automatically before asking

Inspect the target site and determine when possible:

- current logo/brand mark and home destination;
- current menu items, order, labels, and URLs;
- current active-state behavior that must be preserved if the site already has one;
- header foreground/background/accent colors;
- transparent-versus-solid header behavior;
- whether the site already has a language toggle;
- whether it has search, cart, booking, account, email, or other header utilities;
- existing header maximum width and general spacing rhythm;
- whether any menu item opens a megamenu or external destination;
- mobile-only extras already present;
- whether the existing site has special behavior that is part of the intended user experience.

For an existing site, preserve branding, menu content, and intended functionality while moving the common interaction/layout behavior into the package.

### Ask the user if still unknown and required

For a new site, or where the target design does not establish the answer, ask for the unresolved site-specific pieces:

- What logo/brand mark should appear in the header?
- What are the menu items, their order, and destinations?
- Which brand colors should map to menu foreground, background, accent, and borders?
- Should the header begin transparent over a hero or use its solid/blurred state from the top?
- Which utilities belong at the right side of the desktop header and in the mobile panel (language, search, cart, booking, account, etc.)?
- Are there any mobile-only extra items?
- Are any menu items external or expected to open a site-specific megamenu?

Do not ask these if a supplied design, existing site, or brand system already establishes them.

### Visual decisions that remain site-specific

The package owns the interaction model, but site-level appearance still needs to be mapped correctly. Use the site's existing design tokens when available.

Site-specific configuration may include:

- logo dimensions;
- foreground/background/accent colors;
- border opacity;
- maximum header width;
- horizontal/vertical spacing;
- utility content;
- site-specific megamenu content or commerce controls.

If a new site has no design reference and one of those decisions materially affects appearance, ask the user rather than copying Ameyalli's palette or site-specific dimensions blindly.

### Never assume

Do not invent:

- menu labels or URLs;
- logo assets;
- brand colors;
- external links;
- utility controls;
- mobile-only contact/booking content;
- megamenu content;
- a transparent-header requirement when there is no hero/design reason for one.

`ameyalli.space` is the reference for the common interaction system, not a source of another client's branding or menu content.

## Typical use

```tsx
import { SiteMenu } from '@pixelsmith/site-menu'
import '@pixelsmith/site-menu/styles.css'

<SiteMenu
  brand={<Logo />}
  items={navItems}
  utility={<LanguageToggle />}
  mobileUtility={<LanguageToggle direction="right" />}
/>
```

Map the target site's design through CSS custom properties instead of forking package code.

## Post-install verification

Verify:

- all existing/new menu destinations are correct;
- active-state detection works on nested routes;
- desktop hover/focus animation behaves correctly;
- keyboard focus remains visible and usable;
- mobile open/close animation and panel scrolling work;
- tapping a mobile link closes the menu;
- utilities render correctly on both desktop and mobile;
- header/logo/menu do not overflow at common breakpoints;
- transparent/scrolled header behavior matches the target design;
- no duplicate legacy mobile menu remains active;
- site branding remains the target site's branding, not Ameyalli's.
