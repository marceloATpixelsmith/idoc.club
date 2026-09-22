import { execFileSync } from "node:child_process";

if (!process.env.GITHUB_BASE_REF) {
  console.log("Auth catalog change guard skipped outside pull requests.");
  process.exit(0);
}

const base = "origin/" + process.env.GITHUB_BASE_REF;
const changed = execFileSync("git", ["diff", "--name-only", base + "...HEAD"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean);

const sensitive = changed.filter((p) =>
  /^app\/(\(login\)|api\/auth|\(dashboard\)\/dashboard\/security|\(dashboard\)\/admin\/security|\(dashboard\)\/account)/.test(p) ||
  /^lib\/(auth|security|membership)\//.test(p) ||
  /^components\/(security|turnstile-widget)/.test(p) ||
  /^(middleware\.ts|next\.config\.ts|playwright\.security\.config\.ts)$/.test(p) ||
  /^tests\/(security-e2e\/|.*(?:auth|security|mfa|session|csrf|oauth|turnstile|rate|password|recovery|authorization).*)/.test(p)
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
