# @pixelsmith/ecwid-store

Shared Ecwid storefront integration for the standalone Pixelsmith Next.js sites. The package is based on the current `zaxic.mx` storefront architecture and preserves the clean-URL, search, category-navigation, cart, and browser-history behavior that has been refined there.

## Required environment variables

These are the only required Ecwid credential environment variables:

```text
ECWID_API_KEY
ECWID_CLIENT_SECRET
```

Both are server-only. Do not expose either through `NEXT_PUBLIC_*` variables.

The Ecwid store ID is site configuration, not a secret and not a required environment variable.

## Flexible routes

Route language is completely site-configurable. A Spanish site can use `/tienda/categoria/producto/buscar/carrito`; an English site can use `/shop/category/product/search/cart`; a monolingual site can choose any clean route structure that fits its information architecture.

```ts
import { defineEcwidStore } from '@pixelsmith/ecwid-store'

export const ecwidStore = defineEcwidStore({
  storeId: 12345678,
  basePath: '/shop',
  routes: {
    category: 'category',
    product: 'product',
    search: 'search',
    cart: 'cart',
  },
  locales: {
    en: { ecwidLocale: 'en' },
    es: { ecwidLocale: 'es_MX' },
  },
  defaultLocale: 'en',
  search: {
    recentLimit: 5,
    popular: ['ceramics', 'jewelry'],
    showCategoryJumps: true,
  },
})
```

## Storefront pages

`EcwidStorefront` owns the Ecwid Product Browser mount and navigation for:

- store/catalog root
- category view
- product detail
- search results
- shopping cart

The package exposes route builders and parsers for every view:

- `storeUrl()`
- `categoryUrl()`
- `productUrl()`
- `searchUrl()`
- `cartUrl()`
- `parseEcwidStoreRoute()`

It also includes canonical slug helpers. New sites can use the default `<slug>-<Ecwid ID>` form for deterministic route resolution. Existing sites with established clean URLs can provide their own slug resolver without changing their public URLs.

## ZAXIC-derived storefront behavior

The package preserves the important behaviors developed on `zaxic.mx`:

- Ecwid runtime is loaded only when the storefront component mounts rather than globally on every website page.
- site route state remains authoritative while Ecwid initializes.
- site locale can be mapped to the correct Ecwid locale such as `es` → `es_MX`.
- Ecwid product links using either legacy hash forms or `-p<ID>` forms can be intercepted and converted to clean site product URLs.
- legacy Ecwid hash fragments are removed after matching storefront navigation is confirmed.
- browser history entries can be marked as Ecwid pre/final states so transient Ecwid entries do not become user-visible navigation destinations.
- search → product → browser Back can restore a fresh search document rather than allowing stale Ecwid state to replace the custom search/results experience.
- product forward navigation uses the normal page scroll behavior rather than deliberately preserving the product-grid offset.
- category/product links can use `prefetch={false}` to avoid large speculative request bursts caused by a rendered megamenu.
- cached cart quantity remains available before the Ecwid runtime has started.

## Search

`EcwidSearchOverlay` implements the shared product-search behavior rather than exposing Ecwid's inline search box as the primary site search.

Included:

- current query restoration from the URL
- active-query persistence in local storage
- five recent unique searches by default
- case-insensitive recent-search deduplication
- configurable recent-search count
- optional configured popular terms
- optional category jump-to pills
- optional restriction of category jump pills to selected Ecwid category IDs
- search execution only when explicitly submitted or when a recent/popular suggestion is selected
- clearing the active search without deleting recent-search history
- clean document navigation for repeated searches while already inside an Ecwid route, avoiding the Ecwid hash/navigation race found on ZAXIC
- full-height scrollable overlay on small screens

The package CSS hides Ecwid's duplicate inline search controls and search breadcrumbs only inside a `.store-view--search` scope.

Search pages should use:

```ts
robots: { index: false, follow: true }
```

The `ecwidSearchRobots()` helper returns this object.

## Category megamenu

`fetchEcwidMenuCategories()` creates the category tree used by `EcwidMegaMenu`.

It intentionally does **not** trust Ecwid's category `productCount`, because disabled products can make an empty storefront category appear non-empty. Instead it:

1. fetches all categories;
2. fetches all enabled products using paginated `enabled=true` requests;
3. builds the set of category IDs actually used by enabled products;
4. propagates eligibility upward so parents remain visible when an eligible child exists;
5. removes disabled/excluded/empty category branches;
6. builds a localized parent/child category tree.

Consumers can provide a custom sort function when a site's category ordering differs from Ecwid's normal order.

The megamenu closes immediately when a store/category link is selected, and the generated links should remain `prefetch={false}`.

## Cart

`EcwidCartBridge` listens for Ecwid cart changes and persists the last known product quantity in local storage. `getCachedEcwidCartCount()` allows a header to show that count before the storefront runtime starts.

Cart pages should use:

```ts
robots: { index: false, follow: false }
```

The `ecwidCartRobots()` helper returns this object.

## Server API

Import server utilities from:

```ts
import {
  fetchEcwidCategories,
  fetchEnabledEcwidProducts,
  fetchEcwidMenuCategories,
  fetchEcwidProductById,
  fetchEcwidProductsForSitemap,
  readAndVerifyEcwidWebhook,
  verifyEcwidWebhookSignature,
} from '@pixelsmith/ecwid-store/server'
```

All Ecwid REST calls read `ECWID_API_KEY` unless an explicit test override is supplied.

## Webhooks and category cache refresh

`verifyEcwidWebhookSignature()` follows the Ecwid signature behavior used by ZAXIC and signs the literal message:

```text
<eventCreated>.<eventId>
```

with `ECWID_CLIENT_SECRET` using HMAC SHA-256.

`readAndVerifyEcwidWebhook()` also rejects an event whose `storeId` does not match the configured store.

`isEcwidCatalogEvent()` identifies `category.*` and `product.*` events so a site can invalidate/rebuild its cached menu. Product events are included because enabling/disabling or recategorizing a product can change whether categories should remain in the megamenu.

Cache policy itself remains in the consuming Next.js app so the app can use its preferred `revalidateTag`/cache strategy without coupling this package to one Next cache lifetime.

## Site-specific extension points

The following ZAXIC behaviors are deliberately **not hard-coded** into the generic package:

- ZAXIC-specific category IDs or exclusion IDs
- Spanish category names or route words
- ZAXIC product-delivery notice text
- OpenAI product-translation/review workflows
- ZAXIC-specific Brevo maintenance notifications
- ZAXIC-specific popular search terms
- store-specific product/category ordering rules

Those can be supplied through configuration, callbacks, or site code. The storefront infrastructure remains shared.
