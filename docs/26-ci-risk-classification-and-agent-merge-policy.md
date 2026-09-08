# CI risk classification and agent merge policy

This policy tells Codex and Claude which verification level a pull request requires before merge.

## Every pull request

The `Fast PR verification` workflow runs automatically. It covers documentation validation, whitespace, dependency audit, TypeScript, and unit tests.

An agent must inspect the complete changed-file list and the PR description before deciding that this is sufficient.

## Full authentication and security verification

The `Authentication security verification` workflow is required before merge when a pull request changes any of the following:

- Login, signup, logout, password reset, email verification, Google OAuth, MFA, TOTP, recovery codes, trusted devices, sessions, cookies, CSRF, Turnstile, middleware, or security headers.
- Authorization, membership entitlement, onboarding gates, admin or super-admin access, account state, payment access controls, or server-side data-access boundaries.
- Database schema, migrations, authentication-related queries, security libraries, or security end-to-end tests.
- Dependencies or runtime configuration that can affect authentication, authorization, cryptography, HTTP handling, or server rendering.

When in doubt, run this workflow. It must pass for the exact current PR head.

## Full Release 1 verification

The `Release 1 Verification` workflow is required before merge when a pull request changes:

- Application runtime code, routes, Server Components, Server Actions, API handlers, database queries, migrations, build configuration, package dependencies, or integration/build-boundary tests.
- Billing, membership, seminars, directory, administration, publishing, or other behavior that can affect production rendering or database integration.

The workflow is intentionally skipped automatically for low-risk documentation, static-asset, CSS-only, and navigation-loading/menu-only changes. An agent must still run it manually if the change has any plausible build, runtime, integration, or authorization impact.

## Low-risk fast-path examples

The fast check alone is normally sufficient for:

- Documentation-only changes.
- Static assets and CSS-only changes.
- Copy, labels, or presentational markup that does not change data loading, forms, routes, authorization, or server behavior.
- Navigation-loading or menu-only changes that do not alter authentication, permissions, routing, or server data access.

## Required agent procedure

Before merge, the agent must:

1. Inspect the complete diff and classify the change using this document.
2. Run the full workflow required by the classification, if any, against the current PR head.
3. Confirm that the workflow completed successfully, not merely that it was queued.
4. Check for new review comments and resolve every actionable comment.
5. Merge only when the fast check, every required full check, and review state are all clear.

If a workflow is skipped by path filtering but the agent determines that the change is higher risk, the agent must manually dispatch that workflow before merging.
