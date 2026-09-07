# Onboarding demographic form behavior

This document is authoritative for the member demographic onboarding form presentation and defaulting behavior. The signup field dictionary and required professional fields remain defined in `docs/02-membership-and-payment-business-rules.md`.

## Dashboard placement and signup intent

After the password or Google signup step creates the authenticated account, the account opens My Membership inside the dashboard. Until profile onboarding and payment are complete, the other dashboard navigation is hidden and direct requests to those pages return the account to My Membership. The header continues to provide sign-out.

Public links may add a `membership` query parameter to `/sign-up`. The accepted values are `judge`, `steward`, `judge_steward`, and `veterinarian`. Email signup carries a valid value in the signed pending-signup cookie through the email, OTP, and password steps. Google signup carries it through the server-owned OAuth transaction return path. Invalid values are ignored and never become trusted profile data.

When My Membership opens the classification step, a valid carried value preselects the matching card and emphasizes it with the primary gold border, ring, tinted surface, and glow. The member may still choose any other classification before continuing. Profile submission validates the final selection server-side, activates the completed profile, and moves directly to membership payment.

First name and last name are canonical profile fields. The redundant `users.name` field is removed; account settings cannot maintain a second, conflicting name value.

## Section presentation

The demographic form presents ADDRESS, OFFICIAL INFORMATION, and CONSENT as uppercase section headings with clear vertical separation. These sections are not enclosed in rounded gray containers. Field labels remain bold.

## Address autocomplete attribution

The address helper instruction and Geoapify attribution are visually separate. The attribution remains visible but is rendered as small, muted secondary text so it does not compete with the address-entry guidance.

## Address autocomplete geolocation bias

On entering the details step, the form makes a single best-effort request for the browser's current position and, when granted, sends it to the address-autocomplete endpoint as a ranking hint. This never gates or delays typing: a denied, dismissed, or unavailable permission prompt, or any browser without a Geolocation API, simply leaves suggestions unbiased, exactly as before this existed. The hint only re-ranks results the existing country filter already admits; it can never surface a result from a different country.

## Address autocomplete locality field

When a selected suggestion carries a finer-grained locality below city (for example, a colonia on a Mexican address), the form copies that value into Address 2 automatically. A suggestion without one, or a suggestion selected after the member has typed or changed Address 2, leaves Address 2 untouched. Selecting another country clears the address and resets this manual-edit protection for the new address. This is an international secondary-locality rule, not a Mexico-only special case.

## National Federation default

For Judge, Steward, and Judge + Steward onboarding, National Federation is a required professional field and remains fully editable.

When the member selects an address Country, the form automatically uses that same country as the initial National Federation value if National Federation is empty or is still being maintained automatically by the form.

Once the member explicitly selects a non-empty National Federation value, that selection is treated as intentional professional data. Later corrections to the address Country must not overwrite that explicitly selected federation, even when it differs from the residence country.

If the member clears National Federation, it becomes eligible for automatic defaulting again the next time the address Country changes.

Only ISO 3166-1 alpha-2 codes are persisted; the interface displays human-readable country names.

## IDOC Region default

For Judge, Steward, and Judge + Steward onboarding, IDOC Region is a required professional field and remains fully editable.

When the member selects an address Country, the form automatically uses that country's editorially-mapped IDOC Region (`lib/membership/idoc-regions-by-country.ts`) as the initial value if IDOC Region has not yet been explicitly selected by the member.

Once the member explicitly selects an IDOC Region value, that selection is treated as intentional professional data. Later corrections to the address Country must not overwrite that explicitly selected region.

IDOC Region groups countries more coarsely than by continent or address Country -- for example Mexico defaults to Central & Latin America, not North America -- so it is never derived from address Country or National Federation at read time; it is looked up from the maintained mapping.

## Signup-corrections implementation inventory (7 September 2026)

| Requirement | Status | Evidence / disposition |
|---|---|---|
| FEI Number is optional in client and server validation | Already implemented and verified | `feiId` has no HTML `required` attribute and the shared server schema accepts an absent/empty value. |
| The visible label identifies FEI Number as optional | Already implemented and verified | Onboarding renders **FEI Number (optional)**; the stored canonical field remains `feiId`. |
| Best-effort current-geolocation bias | Already implemented and verified | The details step requests browser geolocation once and passes valid coordinates through the authenticated provider proxy as a ranking hint. |
| Denied, unavailable, unsupported, timed-out, or provider-rejected bias does not break entry | Already implemented and verified | Geolocation has a five-second timeout and a no-op error path; autocomplete starts without waiting, omits absent coordinates, and retains manual entry when the provider is unavailable. |
| Provider secondary locality populates Address 2 internationally | Already implemented and verified | The provider's `suburb`/`district` value is exposed generically and copied when present; no country-specific branch is used. |
| Member-entered Address 2 is not overwritten | Already implemented and verified | A member edit marks Address 2 as intentional, preventing subsequent suggestions from replacing it; changing country starts a new blank address and resets that marker. |
| Address country defaults National Federation | Already implemented and verified | ISO country selection supplies the initial federation while the select remains editable. |
| Address country defaults IDOC Region from one authoritative mapping | Already implemented and verified | `lib/membership/idoc-regions-by-country.ts` is the single complete ISO-country mapping used by onboarding. |
| Automatically selected National Federation and Region remain editable | Already implemented and verified | Explicit non-empty selections are preserved across later address-country corrections; clearing a selection opts back into defaulting. |

No signup correction in this slice is blocked or superseded. There is no database or migration impact.
