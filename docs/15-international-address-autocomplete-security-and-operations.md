# International address autocomplete: security, privacy, and operations

This document is the authoritative IDOC contract for the Geoapify-backed international address autocomplete used during member onboarding. It supplements the general requirements in `docs/05-security-and-privacy-requirements.md` and the operational runbook in `docs/07-administrator-and-operations-runbook.md`.

## Scope and data flow

- The member chooses an address country before using autocomplete.
- The browser sends the selected ISO 3166-1 alpha-2 country code and the partial address text currently typed in the Address 1 field to the IDOC server route `GET /api/address/autocomplete`, plus the browser's current coordinates when the member has granted the one-time geolocation permission prompt (a best-effort ranking hint only -- see below).
- The browser never receives or sends the Geoapify API key.
- The IDOC server authenticates the current account before any provider call, rate-limits the request, and then sends the partial address text, selected country filter, and (when present) the coordinates as a proximity bias to Geoapify.
- Geoapify returns candidate structured address data. IDOC returns only the fields needed to populate the editable onboarding form: formatted address, address line 1, city/locality, state/province/region, postal code, country name, country code, and (when the provider result carries one) a finer-grained locality below city, such as a colonia on a Mexican address, which the onboarding form copies into Address 2.
- Selecting a suggestion never makes the provider result authoritative. Every populated address field remains editable, and final profile validation remains server-side in IDOC.

## Privacy contract

Geoapify is an external processor for optional address autocomplete. Partial home-address text entered into the autocomplete field and the selected country are disclosed to Geoapify when autocomplete is available and the member types at least three characters. When the member's browser grants the geolocation permission prompt, their current coordinates are also disclosed to Geoapify as a one-time ranking bias for that request; a denied, dismissed, or unavailable permission simply leaves every request unbiased, with no separate prompt or retry. This is the only page in the application granted the browser's geolocation permission (`next.config.ts`'s `Permissions-Policy` denies it everywhere else). IDOC must not send the member's name, email address, FEI ID, professional role, membership status, payment information, session token, or authentication secret to Geoapify.

Autocomplete is optional convenience functionality. A member must always be able to complete onboarding by entering the address manually if Geoapify is unavailable, disabled, unconfigured, rate-limited, or returns no useful suggestion. Provider failure must not block profile submission once all locally required fields are valid.

The Geoapify credential is server-only. It must never be placed in a `NEXT_PUBLIC_*` variable, client bundle, browser response, log message, screenshot, ticket, or documentation value. Provider response bodies and complete member address queries must not be logged merely to diagnose autocomplete failures.

## Authorization and abuse controls

`GET /api/address/autocomplete` is an authenticated provider proxy. Anonymous requests receive `401` and cannot consume the shared Geoapify key. Valid requests are bounded before the provider call by persistent application rate limits stored in `idoc.account_request_limits`.

The provider-proxy limit uses independent account and request-origin buckets over a 15-minute window. Raw account identifiers and raw IP/origin values are not stored in rate-limit records; only keyed digests derived with the existing server-only `RATE_LIMIT_HASH_KEY` are persisted. The current limits are 60 provider calls per account per 15 minutes and 180 provider calls per request origin per 15 minutes. Exceeding either limit returns `429` with `Retry-After: 900` and does not call Geoapify.

The browser client additionally debounces address lookup requests, but client-side debounce is only a usability/provider-efficiency optimization and is never the security control.

## Configuration

Production autocomplete uses one server-only Vercel environment variable:

`GEOAPIFY_API_KEY`

The variable is optional from the application's availability perspective: if it is absent or blank, `/api/address/autocomplete` returns an unavailable response and the onboarding UI continues in manual-entry mode. The application must not invent a development or production fallback key.

Use separate provider keys for Production and non-production environments where practical. Preview or UAT environments must not expose the Production credential to untrusted deployments.

## Credential rotation

Rotate `GEOAPIFY_API_KEY` immediately if it is suspected to have been disclosed or abused. Create/activate a replacement key with the provider, update the intended Vercel environment, redeploy or otherwise ensure new server instances read the replacement, verify autocomplete, then revoke the old provider key. Never commit either old or new values to source control.

Because the key is not used to encrypt persisted IDOC data, normal rotation does not require a database migration and does not invalidate member records. During a failed or incomplete rotation, manual address entry remains the required fallback.

## Availability and failure behavior

Provider calls have a bounded server timeout. Provider timeout, non-success response, malformed/unusable data, missing configuration, or network failure produces a non-authoritative unavailable response and no member profile mutation. The UI informs the member that autocomplete is unavailable and leaves manual entry enabled.

Geoapify availability must never be a prerequisite for IDOC authentication, onboarding eligibility, profile persistence, billing, or later account access. Existing member profile data is stored in IDOC's database, not fetched from Geoapify at read time.

## Country and federation reference data

Country selectors display human-readable country names while storing ISO 3166-1 alpha-2 codes internally. National Federation uses the same local country reference data but is not an address lookup and must not call Geoapify. The address Country selector is first because it constrains international autocomplete and prevents ambiguous cross-country suggestions.

## Operational checks

During UAT and after material provider/configuration changes, verify:

- anonymous calls to `/api/address/autocomplete` are rejected;
- authenticated calls are filtered to the selected country;
- the shared provider key is absent from browser-visible source and responses;
- rate-limit exhaustion returns `429` without a provider call;
- provider outage or missing key leaves manual entry usable;
- choosing a suggestion populates only address fields and they remain editable;
- National Federation displays country names but persists ISO codes without invoking Geoapify.

Repeated provider failures should be investigated using safe status/category evidence and provider-side quota/configuration dashboards. Do not add full member address queries or secret values to application logs to aid diagnosis.
