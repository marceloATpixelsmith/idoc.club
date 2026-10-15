# 29. Admin Table and Form Style Guide

This guide records how administrator tables, drawers and forms look and behave after the October 2026 corrections. It consolidates the rules in [07 Administrator and Operations Runbook](07-administrator-and-operations-runbook.md#admin-table-and-form-interaction-contract) with the decisions made while fixing Registrations, Members, Seminars/Courses, News/Blog and Support. New admin screens follow it; a deviation needs a stated reason in the pull request. It is a living document: when a rule changes, change it here in the same pull request.

## 1. Naming

- The seminar area is **Seminars/Courses** in every administrator-facing label (navigation, page titles, drawer titles, messages, support category, email-preview category). Singular is "Seminar/Course".
- Status vocabulary: **Registration Status** (Confirmed, Pending FEI Approval, Approved by FEI, Not Approved by FEI, Approved to Audit Only by FEI) is independent of **Payment Status** (Unpaid, Pending, Bank transfer pending, Cash pending, Paid, Refunded, and so on). Show them together as `Status: <Registration Status> / <Payment Status>` where one line is needed.

## 2. Tables

- Every record table is the shared `DataTable`: server-backed search, facets, sort, page size 10/25/50/100, column visibility and order persisted per administrator, CSV export where the data is useful.
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

- Forms are carded sections with a small uppercase gold heading (`AdminFormSection` / `FormSection`). Group related fields; do not produce one long vertical list.
- **Field width:** short, related fields share a row two to a row (`grid gap-4 sm:grid-cols-2`). A lone short control (a select, a date, a reference) is capped at half width (`max-w-sm`). Only content that benefits from width spans the row: titles, URLs, member lookup, long text, rich text.
- Labels sit directly above their control with a consistent gap; help text is visually separated from both.
- Booleans are the shared toggle (`FormToggle`), not checkboxes or Yes/No selects. Multi-value checklists and mutually exclusive status radios keep their own controls.
- Inputs are **controlled** wherever the server can reject a submission: React resets uncontrolled fields after a form action, which wipes what the administrator typed. Keep typed values on error.
- All single date-only fields in administrator **and member-facing** forms use the shared `SingleDatePicker` (`components/forms/us-date-input.tsx`): click anywhere on the date field to open its calendar, show `dd/mm/yyyy` in the trigger, do not render a separate calendar button, and submit ISO `yyyy-mm-dd`. This applies to publishing, payment, entitlement, and seminar deadline dates. Existing controlled payment date interactions must remain controlled; min/max bounds must be respected.
- Seminar Start / End dates use one shared `DateRangePicker` (`components/forms/date-range-picker.tsx`) that selects both dates with one calendar and still submits `startDate` and `endDate` separately. Date range filters keep their own existing behavior and show `dd/mm/yyyy` endpoints. Neither form picker should use a locale-dependent native date input.
- Required fields are marked required in the control and enforced again on the server.

## 5. Payment evidence

- A payment recorded by an administrator always carries evidence, required and labelled for how it was paid: **Stripe Payment ID** (Stripe), **Bank Transfer Reference** (Bank Transfer), **Receipt ID** (Cash). A complimentary membership grant is not a payment and has none.
- Seminar registrations offer the same three sources as the member form -- Cash, Bank Transfer, Stripe -- with the same labels (**Receipt ID**, **Bank Transfer Reference**, **Stripe Payment ID**), via `lib/seminars/payment-reference.ts`. The same rule applies to membership payments and to seminar registrations, whether the payment is recorded after the fact ("Record payment received" in the registration drawer) or when the registration is created as Paid.
- The evidence field is cleared when the payment source or method changes, so evidence typed for one source cannot be submitted as another. Online (Stripe Checkout) seminar payments are recorded by the webhook and never go through this form.

## 6. Where this is enforced

Source-level tests pin the shared drawer hook, the per-record keys, the half-width pairs, the evidence labels and the close behavior (`tests/admin-drawer-refresh.test.ts`, `tests/admin-form-success-behavior.test.ts`, `tests/admin-member-experience.test.ts`, `tests/seminars.test.ts`).

## 7. Staging email previews

- The Super Admin Email Previews page shows distinct FEI and non-FEI registration confirmations and four FEI registration-status change variants, using the actual registration-email body renderer. Payment-confirmed and refund-confirmed notices also have individual previews.
- Each preview uses an asynchronous form submission, an immediate disabled Sending… button, and an inline acceptance/failure result; submitting an individual preview never requires a full-page navigation. Bulk sending lists any failed templates.
- Every submission requires a valid CSRF token and Super Admin authorization; the preview page remains unavailable in Production. Sending previews never creates registrations, changes statuses, captures payments, or processes refunds.
