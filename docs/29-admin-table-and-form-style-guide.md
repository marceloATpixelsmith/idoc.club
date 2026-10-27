# 29. Admin Table and Form Style Guide

This guide records how administrator tables, drawers and forms look and behave after the October 2026 corrections. It consolidates the rules in [07 Administrator and Operations Runbook](07-administrator-and-operations-runbook.md#admin-table-and-form-interaction-contract) with the decisions made while fixing Registrations, Members, Seminars/Courses, News/Blog and Support. New admin screens follow it; a deviation needs a stated reason in the pull request. It is a living document: when a rule changes, change it here in the same pull request.

## 1. Naming

- The seminar area is **Seminars/Courses** in every administrator-facing label (navigation, page titles, drawer titles, messages, support category, email-preview category). Singular is "Seminar/Course".
- Status vocabulary: **Registration Status** (Confirmed, Pending FEI Approval, Approved by FEI, Not Approved by FEI, Approved to Audit Only by FEI) is independent of **Payment Status** (Unpaid, Pending, Bank transfer pending, Cash pending, Paid, Refunded, and so on). Show them together as `Status: <Registration Status> / <Payment Status>` where one line is needed.

## 2. Tables

- Every record table is the shared `DataTable`: server-backed search, facets, sort, page size 10/25/50/100, column visibility and order persisted per administrator, CSV export where the data is useful.
- A read-only report table with no server-side selected-row export (Communications' renewal-notice lists) omits `tableType`, which hides the Export action; the others pass it. Read-only report tables (`AdminReadOnlyTable`) give the status/category column a multi-select filter through `statusColumn`, and any further column a multi-select value filter through `filterColumns` (the Stripe Reconciliation table filters by **Category** and **Type**). Filters combine, work with search and the date range, and clear with the Reset button.
- `AdminReadOnlyTable` filters, searches and sorts in the browser, so it flashes the pulsing loading skeleton briefly (about 0.4 s, re-armed by each change) on every filter, search, sort or date-range change, keeping it consistent with server-backed tables. Reconciliation CSV exports always include the involved member's name and email and a reason for manual review.
- Selection-bar actions added through `bulkActions` belong to one row Type and are enabled only while every selected row is that Type (otherwise disabled with the reason); they are re-checked on the server. The Stripe Reconciliation table's only such action is **Ignore** (docs/04 §9.1).
- The Members table's Actions column carries a **Timeline** icon that opens the read-only Member timeline as its own wide drawer (`?timeline=<profileId>`, docs/07 §13.3); a timeline is never a tab inside the member form. Its rows have Time, Who, Type (icon only) and What happened columns, and it uses the standard multi-column Sort button (`DataTableSortList`) over the Time, Who and Type columns, never a custom sort control. Its date range, who-did-it and sort filters are saved per administrator in `administrator_table_preferences` (`member_timeline`) and restored on refresh, like every table's, never in the URL.
- A count that stands for a list of people (the non-delivered counts on Communications) is a button that opens a popup of the addresses, one per line, each linking to that person's drawer; a zero is plain text.
- **Text-style buttons (a count, an inline link that runs an action) must opt out of the default button look.** `app/globals.css` turns every plain `<button>` into a gold pill (and `base` makes every button uppercase, bold and letter-spaced) unless it has a `bg-` class, so a link-style button carries `bg-transparent normal-case tracking-normal` (plus its own colour, underline and weight) or it renders as a gold blob with gold text on it. `tests/link-style-buttons.test.ts` fails the build for an underlined `<button>` that does not.
- Row actions live in the Actions column (edit pencil, record-specific shortcuts). Seminars/Courses and News/Blog must also provide a Copy action that creates a separate draft with `(copy)` appended to the title, without copying registrations, payments, or analytics. Navigation, export and preview shortcuts are table-level, never inside a drawer.
- Selection-based changes (close selected, apply status, delete) live in the table action bar and are server-authorized and audited.
- Loading: tables, revenue summary cards, and other server-backed data views show pulsing skeletons as soon as a filter, sort, search, page change, refresh, or successful mutation begins. Skeletons remain visible until the new data is reflected in the view; do not remove the loading indication merely when a request is submitted. Drawer-close refreshes also show skeletons.
- All application date-only fields and admin table/date-range displays use **dd/mm/yyyy**. Long-form editorial dates can retain their explicitly designed month-name presentation.

## 3. Drawers

- Create and edit open in the shared drawer (about 70vw, max 5xl; full width on small screens) over the table. No standalone edit pages.
- One close behavior for every drawer, through `useAdminDrawerClose`: the URL returns to the bare table URL with a single `router.replace` (never `push`, so Back cannot re-open the record), the table skeleton shows, and the table refreshes. This applies to the X, the overlay, Escape and a successful save alike.
- Every drawer mount in a page carries a per-record `key` (`key="new"` or the record id) so selecting another record never inherits a previous drawer's closed state.
- A successful submit closes the drawer immediately. Validation and server errors stay in the drawer and never close it; no success message stays in an open drawer.
- Server actions revalidate the table's own path (the list page), not a detail path.

## 4. Forms

- **Minimum text size:** no text in any admin table, drawer or form is smaller than 13px (`text-xs` is already 13px). Do not add `text-[11px]`/`text-[12px]`-style overrides; `tests/minimum-text-size.test.ts` enforces this sitewide.
- Forms are carded sections with a small uppercase gold heading (`AdminFormSection` / `FormSection`). Group related fields; do not produce one long vertical list.
- **Field width:** short, related fields share a row two to a row (`grid gap-4 sm:grid-cols-2`). A lone short control (a select, a date, a reference) is capped at half width (`max-w-sm`). Only content that benefits from width spans the row: titles, URLs, member lookup, long text, rich text.
- Labels sit directly above their control with a consistent gap; help text is visually separated from both.
- Booleans are the shared toggle (`FormToggle`), not checkboxes or Yes/No selects. Multi-value checklists and mutually exclusive status radios keep their own controls.
- Support category default assignment forms revalidate their own `/admin/support/defaults` page after saving. Their multi-select control remounts when saved assignments change, immediately reflecting persisted selections without requiring a manual refresh.
- Inputs are **controlled** wherever the server can reject a submission: React resets uncontrolled fields after a form action, which wipes what the administrator typed. Keep typed values on error. File inputs cannot be controlled, so a form that must keep chosen files after a result (the temporary legacy import) submits by hand with `onSubmit` and `event.preventDefault()` instead of passing a React form action.
- All single date-only fields in administrator **and member-facing** forms use the shared `SingleDatePicker` (`components/forms/us-date-input.tsx`): click anywhere on the date field to open its calendar, show `dd/mm/yyyy` in the trigger, do not render a separate calendar button, and submit ISO `yyyy-mm-dd`. This applies to publishing, payment, entitlement, and seminar deadline dates. Existing controlled payment date interactions must remain controlled; min/max bounds must be respected.
- A field that needs a moment in time (a date and a time) uses the shared `DateTimePicker` (`components/forms/date-time-picker.tsx`): the date opens the same calendar as `SingleDatePicker`, the time is an hour and a minute select, the person chooses in their own local time and the field submits the UTC `YYYY-MM-DDTHH:MM` under its name and shows that UTC value beside it. Never a free-text date or time field.
- Seminar Start / End dates use one shared `DateRangePicker` (`components/forms/date-range-picker.tsx`) that selects both dates with one calendar and still submits `startDate` and `endDate` separately. Date range filters keep their own existing behavior and show `dd/mm/yyyy` endpoints. Neither form picker should use a locale-dependent native date input.
- The member drawer's **Email preferences** card shows the member's "Keep me updated by email" toggle (docs/19). An administrator can only switch it off; when the member is not subscribed the card shows text instead of a toggle, because opting in is the member's own consent.
- Required fields are marked required in the control and enforced again on the server.
- **Countries are shown by name, never by their two-letter ISO code**, in administrator and member-facing selects and table cells. The stored value stays the ISO code; select options and cell labels come from `COUNTRY_OPTIONS` / `countryNameForCode` (`lib/membership/countries.ts`, sorted by name). In the Members roster, Country is a display and sort column; National Federation remains the country-based facet. The member form's Country and National Federation selects use `COUNTRY_OPTIONS`; `tests/admin-member-experience.test.ts` fails if a screen lists `ISO_COUNTRY_CODES` directly.

## 5. Payment evidence

- A payment recorded by an administrator always carries evidence, required and labelled for how it was paid: **Stripe Payment ID** (Stripe), **Bank Transfer Reference** (Bank Transfer), **Receipt ID** (Cash). A complimentary membership grant is not a payment and has none.
- Seminar registrations offer the same three sources as the member form -- Cash, Bank Transfer, Stripe -- with the same labels (**Receipt ID**, **Bank Transfer Reference**, **Stripe Payment ID**), via `lib/seminars/payment-reference.ts`. The same rule applies to membership payments and to seminar registrations, whether the payment is recorded after the fact ("Record payment received" in the registration drawer) or when the registration is created as Paid.
- The evidence field is cleared when the payment source or method changes, so evidence typed for one source cannot be submitted as another. Online (Stripe Checkout) seminar payments are recorded by the webhook and never go through this form.

## 5a. Dialogs instead of browser pop-ups

- No browser `alert()`, `confirm()` or `prompt()` is used anywhere; a test fails if one appears. Use `useBrandedDialogs()` (`components/ui/branded-dialogs.tsx`): `alert(message, title?)` for notices and `await confirm({ message, confirmLabel, destructive })` for confirmations. They use the same dialog look as the authenticator prompt and keep line breaks in long messages. Render the returned `dialogs` once in the component.
- Every dialog can be left. Notices have OK; confirmations have Cancel and also close on Escape or a click away (counted as "no"); the authenticator prompt has Cancel and Escape cancels it. A dialog never traps someone behind a disabled button.
- Archiving never asks for an authenticator code; permanent deletion does.
- Permanent member deletion that would orphan authored content does not end in an error notice: the bulk-delete dialog asks which active Administrator or Super Administrator takes the content over (Select, acting admin preselected, Cancel and a destructive **Reassign and delete**), then retries with that choice (see docs/07).

## 6. Where this is enforced

Source-level tests pin the shared drawer hook, the per-record keys, the half-width pairs, the evidence labels and the close behavior (`tests/admin-drawer-refresh.test.ts`, `tests/admin-form-success-behavior.test.ts`, `tests/admin-member-experience.test.ts`, `tests/seminars.test.ts`).

## 7. Staging email previews

- The Super Admin Email Previews page shows distinct FEI and non-FEI registration confirmations and four FEI registration-status change variants, using the actual registration-email body renderer. Payment-confirmed and refund-confirmed notices also have individual previews.
- Each preview uses an asynchronous form submission, an immediate disabled Sending… button, and an inline acceptance/failure result; submitting an individual preview never requires a full-page navigation. Bulk sending lists any failed templates.
- Every submission requires a valid CSRF token and Super Admin authorization; the preview page remains unavailable in Production. Sending previews never creates registrations, changes statuses, captures payments, or processes refunds.

## Every filter is saved per administrator, even when it is not a real table

Anything an administrator can filter, search, sort or range in the admin - including read-only report tables (`AdminReadOnlyTable`), the Communications tables and the Member timeline drawer - saves its view in `administrator_table_preferences` and restores it on refresh. `AdminReadOnlyTable` takes a `preferenceKey` and the server-loaded `initialPreferences`; a new filterable view adds its identifier to `ADMIN_TABLE_IDENTIFIERS` and a schema in `lib/admin/table-preferences.ts` (the database only checks the identifier's shape, so no migration is needed). A filter that lives only in browser state is a bug.

## Filters and view state never use URL parameters (sitewide)

Search, facet filters, sort, page and page size are never written to or read from the URL. Administrator tables persist them per user in `administrator_table_preferences` (see `lib/admin/table-preferences.ts`); the member directory, which has no administrator-only database table, persists them in the validated `idoc-directory-view` cookie (`lib/directory/member-directory-view.ts`). Either way the client saves the state and calls `router.refresh()` on the same URL. Navigation state such as `?tab=` or a record id may remain in the URL.
