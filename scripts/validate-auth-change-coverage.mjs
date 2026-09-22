import { execFileSync } from "node:child_process";

if (!process.env.GITHUB_BASE_REF) {
  console.log("Auth catalog change guard skipped outside pull requests.");
  process.exit(0);
}

const base = "origin/" + process.env.GITHUB_BASE_REF;
const changed = execFileSync("git", ["diff", "--name-only", base + "...HEAD"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean);

const sensitive = changed.filter((p) =>
  p.startsWith("app/(login)/") ||
  p.startsWith("app/api/auth/") ||
  p.startsWith("app/(dashboard)/dashboard/security/") ||
  p.startsWith("app/(dashboard)/admin/security/") ||
  p.startsWith("app/(dashboard)/onboarding/") ||
  p.startsWith("app/(dashboard)/account/") ||
  p.startsWith("app/(dashboard)/admin/members/") ||
  p === "app/(dashboard)/layout.tsx" ||
  p === "app/(dashboard)/dashboard/layout.tsx" ||
  p.startsWith("app/api/user/") ||
  p.startsWith("components/security/") ||
  p === "components/turnstile-widget.tsx" ||
  p.startsWith("lib/auth/") ||
  p.startsWith("lib/security/") ||
  p.startsWith("lib/membership/") ||
  p.startsWith("lib/runtime/") ||
  p.startsWith("lib/db/") ||
  p === "middleware.ts" ||
  p === "next.config.ts" ||
  p === "package.json" ||
  p === "pnpm-lock.yaml" ||
  p.startsWith("tests/security-e2e/") ||
  /^tests\/.*auth.*$/i.test(p) ||
  /^tests\/.*security.*$/i.test(p) ||
  p.startsWith("tests/auth/")
);

if (!sensitive.length) {
  console.log("No auth/security-sensitive files changed.");
  process.exit(0);
}

const catalogChanged = changed.some((p) =>
  p === "tests/auth/auth-test-matrix.json" ||
  p === "docs/security/AUTH_TEST_CATALOG.md" ||
  p === "docs/security/AUTH_TEST_COVERAGE.md"
);

if (catalogChanged) {
  console.log("Auth/security-sensitive change includes synchronized auth test catalog updates.");
  process.exit(0);
}

const body = process.env.PR_BODY || "";
const marker = body.match(/AUTH-TEST-CATALOG-NO-CHANGE:\s*(.+)/i);
if (marker && marker[1].trim().length >= 20) {
  console.log("Auth catalog no-change rationale accepted: " + marker[1].trim());
  process.exit(0);
}

throw new Error(
  "Auth/security-sensitive files changed without updating tests/auth/auth-test-matrix.json. " +
  "Update the canonical test case first, or add a PR-body line 'AUTH-TEST-CATALOG-NO-CHANGE: <specific rationale>'. " +
  "Sensitive files: " + sensitive.join(", ")
);
