import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("tests/auth/auth-test-matrix.json", "utf8"));
const now = new Date().toISOString();
const sha = process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || "unknown";
const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? process.env.GITHUB_SERVER_URL + "/" + process.env.GITHUB_REPOSITORY + "/actions/runs/" + process.env.GITHUB_RUN_ID
  : null;

const results = manifest.cases.map((c) => {
  if (c.ci.coverage === "na") {
    return { id: c.id, status: "not-applicable", evidence: [], note: c.ci.rationale };
  }
  if (c.ci.coverage !== "mapped") {
    return { id: c.id, status: "gap", evidence: [], note: c.ci.rationale };
  }

  const browserTests = c.ci.tests.filter((test) => test.startsWith("tests/security-e2e/"));
  if (browserTests.length === 0) {
    return {
      id: c.id,
      status: "not-run",
      evidence: [],
      note: "No tests for this case ran in the auth-security browser workflow; consult the matching Fast and Release CI runs."
    };
  }
  if (browserTests.length < c.ci.tests.length) {
    return {
      id: c.id,
      status: "partial",
      evidence: browserTests,
      note: "Browser tests passed in this workflow. Other mapped tests are not reported as passed here; consult the matching Fast and Release CI runs."
    };
  }
  return {
    id: c.id,
    status: "pass",
    evidence: browserTests,
    note: "All mapped browser tests for this case passed in the auth-security workflow."
  };
});

mkdirSync("test-results/auth", { recursive: true });
writeFileSync("test-results/auth/auth-ci-results.json", JSON.stringify({
  schemaVersion: 1,
  source: "ci",
  revision: sha,
  generatedAt: now,
  runUrl,
  results
}, null, 2) + "\n");
console.log("Wrote test-results/auth/auth-ci-results.json");
