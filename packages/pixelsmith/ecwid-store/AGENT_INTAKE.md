# @pixelsmith/ecwid-store — Agent Intake Checklist

Read `../../AGENT_INTEGRATION.md` and `README.md` before implementing this package.

## Automatic package standards

Do not ask the user to choose these unless they explicitly request a different shared standard:

- clean Next.js storefront routes rather than exposing Ecwid hash URLs;
- support for store root, category, product, search, and cart views;
- lazy Ecwid runtime loading only when storefront functionality mounts;
- custom site search as the primary search experience rather than Ecwid's duplicate inline search UI;
- recent-search persistence and deduplication;
- clean repeated-search behavior while already inside store routes;
- search → product → browser Back restoration;
- category megamenu driven by Ecwid categories;
- category eligibility based on actual enabled products, including ancestor propagation;
- cached cart quantity before the Ecwid runtime starts;
- configurable routes and site branding rather than ZAXIC-specific hard-coding;
- server-only Ecwid credentials using exactly:
  - `ECWID_API_KEY`
  - `ECWID_CLIENT_SECRET`;
- search pages use `noindex, follow`;
- cart pages use `noindex, nofollow`.

## Infer automatically before asking

Inspect the target repository and existing store, if any, to determine when possible:

- Ecwid store ID;
- existing store base path;
- category/product/search/cart route segments;
- URLs that already exist and must remain stable;
- site languages and Ecwid locale mapping;
- current category exclusions/order rules;
- current search UI, recent-search behavior, popular terms, and category-jump behavior;
- current megamenu dimensions, placement, columns, typography, colors, separators, hover/focus behavior, and mobile treatment;
- current cart/search/header controls;
- existing product/category slug strategy;
- whether an Ecwid webhook/category-cache refresh already exists;
- site-specific product notices or other extensions that should remain site-local.

For an existing store, preserve public URLs, intended search/cart/category behavior, and established visual design unless the task explicitly changes them.

## Ask the user if still unknown and required

For a new Ecwid store, or when the repository does not establish the answer, ask the unresolved items together:

- What is the Ecwid store ID?
- What should the store base URL be, for example `/shop`, `/store`, `/tienda`, or another path?
- What route words should be used for category, product, search, and cart?
- Which site languages are supported, and what Ecwid locale should each map to when not obvious?
- Should search show category jump-to pills?
- If category jump pills are enabled, should they show all eligible top-level categories or only selected category IDs?
- Should search show popular-search pills, and if so what terms?
- Are any Ecwid categories intentionally excluded from navigation?
- Does the store require custom category ordering beyond Ecwid's normal order?
- What should the megamenu look like on this site if no existing design establishes it: panel width, column treatment, background, typography, separators, hover/focus treatment, and mobile presentation?
- Should the megamenu inherit the site's existing header/menu design tokens? Default to yes for an existing site.
- Are there established product/category URLs that must be preserved rather than using the package's default deterministic slug form?
- Are there site-specific product notices, policies, or extensions that must appear in product views?

Do not ask any question whose answer is already unambiguous in the current site, design, or user prompt.

## Megamenu visual intake

The package owns category data, eligibility, hierarchy, navigation safety, and shared responsive behavior. The consuming site owns brand presentation where configurable.

When no existing site design establishes the megamenu appearance, collect enough information to configure:

- alignment to the header or viewport;
- bounded versus full-width panel;
- number/flow of desktop columns;
- background and border treatment;
- category-heading and child-item typography;
- accent/hover/focus treatment;
- spacing density;
- whether descriptions or other category metadata should be displayed;
- mobile nesting/expansion treatment if the default package presentation is not sufficient for the requested design.

Never copy ZAXIC's colors, category IDs, labels, ordering, or dimensions simply because ZAXIC is the canonical implementation reference.

## Environment values

The agent should wire the standardized names automatically but must never invent their values:

```text
ECWID_API_KEY
ECWID_CLIENT_SECRET
```

If the values are unavailable, complete safe repository-side wiring and tell the user exactly which values must be added in the deployment environment.

The store ID is normal site configuration. Do not silently invent one or substitute a store ID from another project.

## Never assume

Do not invent:

- store ID;
- category/product IDs;
- category exclusions;
- popular search terms;
- route vocabulary;
- locale mappings for unknown languages;
- recipient/business notifications unrelated to core storefront behavior;
- product notices or policies;
- megamenu colors/layout when neither the site nor user establishes them;
- ZAXIC-specific translation/OpenAI workflows;
- ZAXIC-specific delivery copy or maintenance behavior.

## Post-install verification

Verify at minimum:

- store root loads products;
- direct category URL loads the intended category;
- direct product URL loads the intended product;
- direct search URL loads the intended query;
- direct cart URL loads the cart;
- no legacy Ecwid hash remains visible after navigation settles;
- category → product → Back restores the category;
- search → product → Back restores the exact search/results state;
- repeated searches while already inside the store remain hash-free and functional;
- search overlay reopens and remains functional after browser navigation;
- recent searches persist and deduplicate correctly;
- category jump pills, if enabled, point to canonical category URLs;
- megamenu contains only eligible categories and closes when navigation begins;
- categories containing only disabled products do not appear;
- parent categories remain when eligible children exist;
- cart count updates and cached count survives non-store pages;
- language switching preserves the current store/product/category/search/cart intent;
- search/cart robots metadata is correct;
- sitemap integration, when used, includes intended enabled products/categories;
- desktop/mobile megamenu and search UI match the target site's branding and remain responsive;
- no ZAXIC-specific IDs, copy, secrets, or business rules leaked into the target site.
