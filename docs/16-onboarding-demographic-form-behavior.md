# Onboarding demographic form behavior

This document is authoritative for the member demographic onboarding form presentation and defaulting behavior. The signup field dictionary and required professional fields remain defined in `docs/02-membership-and-payment-business-rules.md`.

## Section presentation

The demographic form presents ADDRESS, OFFICIAL INFORMATION, and CONSENT as uppercase section headings with clear vertical separation. These sections are not enclosed in rounded gray containers. Field labels remain bold.

## Address autocomplete attribution

The address helper instruction and Geoapify attribution are visually separate. The attribution remains visible but is rendered as small, muted secondary text so it does not compete with the address-entry guidance.

## National Federation default

For Judge, Steward, and Judge + Steward onboarding, National Federation is a required professional field and remains fully editable.

When the member selects an address Country, the form automatically uses that same country as the initial National Federation value if National Federation is empty or is still being maintained automatically by the form.

Once the member explicitly selects a non-empty National Federation value, that selection is treated as intentional professional data. Later corrections to the address Country must not overwrite that explicitly selected federation, even when it differs from the residence country.

If the member clears National Federation, it becomes eligible for automatic defaulting again the next time the address Country changes.

Only ISO 3166-1 alpha-2 codes are persisted; the interface displays human-readable country names.
