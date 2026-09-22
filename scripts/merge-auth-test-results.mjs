import { readFileSync, writeFileSync } from "node:fs";

const ciPath = process.argv[2] || "test-results/auth/auth-ci-results.json";
const livePath = process.argv[3] || "test-results/auth/auth-live-results.json";
const outPath = process.argv[4] || "test-results/auth/auth-combined-results.md";

const manifest = JSON.parse(readFileSync("tests/auth/auth-test-matrix.json", "utf8"));
const ci = JSON.parse(readFileSync(ciPath, "utf8"));
const live = JSON.parse(readFileSync(livePath, "utf8"));
const byCi = new Map(ci.results.map((r) => [r.id, r]));
const byLive = new Map(live.results.map((r) => [r.id, r]));

const rows = manifest.cases.map((c) => {
  const ciStatus = byCi.get(c.id)?.status || "missing";
  const liveStatus = c.live.enabled ? (byLive.get(c.id)?.status || "missing") : "not-applicable";
  return "| " + c.id + " | " + c.title.replaceAll("|", "/") + " | " + ciStatus + " | " + liveStatus + " |";
});

writeFileSync(outPath,
  "# Combined Authentication Test Results\n\n" +
  "CI revision: " + (ci.revision || "unknown") + "  \n" +
  "Live target: " + (live.target?.hostname || "unknown") + "  \n" +
  "Live revision: " + (live.target?.revision || "unknown") + "\n\n" +
  "| ID | Requirement | CI | Live staging |\n|---|---|---|---|\n" +
  rows.join("\n") + "\n"
);
console.log("Wrote " + outPath);
