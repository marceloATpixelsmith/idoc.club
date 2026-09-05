# Onboarding demographic form behavior

This document is authoritative for the member demographic onboarding form presentation and defaulting behavior. The signup field dictionary and required professional fields remain defined in `docs/02-membership-and-payment-business-rules.md`.

## Section presentation

The demographic form presents ADDRESS, OFFICIAL INFORMATION, and CONSENT as uppercase section headings with clear vertical separation. These sections are not enclosed in rounded gray containers. Field labels remain bold.

## Address autocomplete attribution

The address helper instruction and Geoapify attribution are visually separate. The attribution remains visible but is rendered as small, muted secondary text so it does not compete with the address-entry guidance.

## Address autocomplete geolocation bias

On entering the details step, the form makes a single best-effort request for the browser's current position and, when granted, sends it to the address-autocomplete endpoint as a ranking hint. This never gates or delays typing: a denied, dismissed, or unavailable permission prompt, or any browser without a Geolocation API, simply leaves suggestions unbiased, exactly as before this existed. The hint only re-ranks results the existing country filter already admits; it can never surface a result from a different country.

## Address autocomplete locality field

When a selected suggestion carries a finer-grained locality below city (for example, a colonia on a Mexican address), the form copies that value into Address 2 automatically. A suggestion without one leaves Address 2 untouched by that field.

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
