import { readFileSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("tests/auth/auth-test-matrix.json", "utf8"));

function makeCatalog() {
  let s = "# Authentication & Security Test Catalog\n\n";
  s += "**Authoritative source:** `tests/auth/auth-test-matrix.json`. This document is generated from that file. Do not edit pass/fail criteria here independently.\n\n";
  s += "## Operating model\n\nCI and live staging are two execution layers for the same requirements. CI proves deterministic repository-controlled behavior; live staging proves deployment, browser, real-provider, real-email, cookie/domain, and operational behavior. Results must always use the same `LIVE-AUTH-###` IDs.\n\n";
  s += "A defect is not fully regression-covered until it maps to one of these IDs (or a new ID is added), has CI coverage where technically possible, and has live coverage when the failure depends on deployment/provider/runtime behavior.\n\n";
  for (const c of manifest.cases) {
    s += "## " + c.id + " — " + c.title + "\n\n";
    s += "- **Risk:** " + c.risk + "\n";
    s += "- **Applicability:** " + c.applicability + "\n";
    s += "- **Canonical controls:** " + (c.canonicalControls.join(", ") || "None") + "\n";
    s += "- **CI coverage:** " + c.ci.coverage;
    if (c.ci.tests.length) s += " — " + c.ci.tests.map((x) => "`" + x + "`").join(", ");
    if (c.ci.rationale) s += " — " + c.ci.rationale;
    s += "\n";
    s += "- **Live:** " + (c.live.enabled ? "required" : "not applicable") + "; email=" + (c.live.requiresEmail ? "yes" : "no") + "; admin=" + (c.live.requiresAdmin ? "yes" : "no") + "; destructive=" + (c.live.destructive ? "yes" : "no") + "\n\n";
    if (c.live.preconditions.length) s += "### Preconditions\n" + c.live.preconditions.map((x) => "- " + x).join("\n") + "\n\n";
    if (c.live.steps.length) s += "### Steps\n" + c.live.steps.map((x, i) => String(i + 1) + ". " + x).join("\n") + "\n\n";
    s += "### PASS\n" + c.live.pass.map((x) => "- " + x).join("\n") + "\n\n";
    s += "### FAIL\n" + c.live.fail.map((x) => "- " + x).join("\n") + "\n\n";
    if (c.live.cleanup.length) s += "### Cleanup\n" + c.live.cleanup.map((x) => "- " + x).join("\n") + "\n\n";
    if (c.live.evidence.length) s += "### Evidence\n" + c.live.evidence.map((x) => "- " + x).join("\n") + "\n\n";
  }
  return s.trimEnd() + "\n";
}

function makeCoverage() {
  const rows = manifest.cases.map((c) => "| " + c.id + " | " + c.title.replaceAll("|", "/") + " | " + c.ci.coverage + " | " + (c.live.enabled ? "required" : "N/A") + " | " + c.canonicalControls.join(", ") + " |");
  const mapped = manifest.cases.filter((c) => c.ci.coverage === "mapped").length;
  const gaps = manifest.cases.filter((c) => c.ci.coverage === "gap").length;
  const na = manifest.cases.filter((c) => c.ci.coverage === "na").length;
  return "# Authentication Test Coverage Matrix\n\nGenerated from `tests/auth/auth-test-matrix.json`.\n\nSummary: **" + manifest.cases.length + " cases** — CI mapped " + mapped + ", CI gaps " + gaps + ", not applicable " + na + ".\n\n| ID | Requirement | CI | Live staging | Canonical controls |\n|---|---|---|---|---|\n" + rows.join("\n") + "\n";
}

const expected = [
  ["docs/security/AUTH_TEST_CATALOG.md", makeCatalog()],
  ["docs/security/AUTH_TEST_COVERAGE.md", makeCoverage()]
];
const check = process.argv.includes("--check");
let stale = false;
for (const [path, body] of expected) {
  if (check) {
    if (readFileSync(path, "utf8") !== body) {
      console.error(path + " is stale. Run: pnpm generate:auth-test-docs");
      stale = true;
    }
  } else {
    writeFileSync(path, body);
  }
}
if (stale) process.exit(1);
console.log(check ? "Auth test generated documentation is current." : "Generated auth test documentation.");
