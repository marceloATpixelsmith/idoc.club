import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("tests/auth/auth-test-matrix.json", "utf8"));
const revision = process.env.GITHUB_SHA || "unknown";
const hostname = new URL(process.env.LIVE_AUTH_BASE_URL || "https://staging.idoc.club").hostname;
const automatedPath = "test-results/auth/live-automated-case-results.json";
let automated;
try {
  automated = JSON.parse(readFileSync(automatedPath, "utf8"));
} catch {
  automated = { startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), results: [] };
}
const byId = new Map((automated.results || []).map((item) => [item.id, item]));
const results = manifest.cases.map((item) => {
  if (!item.live.enabled) return { id: item.id, status: "not-applicable", summary: "Not applicable by the authoritative test matrix.", evidence: [] };
  if (item.live.automation?.mode === "manual-only") return { id: item.id, status: "blocked", summary: "Manual-only provider flow; unattended GitHub Actions does not attempt or pass it.", evidence: [] };
  const completed = byId.get(item.id);
  if (completed) return completed;
  return { id: item.id, status: "blocked", summary: "This live case is not yet implemented in the GitHub Actions browser runner.", evidence: [] };
});
const counts = Object.fromEntries(["pass", "partial", "fail", "blocked", "not-applicable"].map(status => [
  status, results.filter(item => item.status === status).length,
]));
const applicable = results.length - counts["not-applicable"];
const verified = applicable > 0 && counts.pass === applicable && counts.fail === 0 && counts.partial === 0 && counts.blocked === 0;
const verification = {
  status: verified ? "verified" : counts.fail > 0 ? "failed" : "incomplete",
  fullyVerified: counts.pass,
  applicable,
  partiallyExercised: counts.partial,
  failed: counts.fail,
  notRun: counts.blocked,
  explanation: verified
    ? "Every applicable live authentication requirement was fully exercised and passed."
    : counts.fail > 0
      ? "One or more live authentication assertions failed. Authentication is not verified."
      : "This is a partial real-staging smoke test. Unexercised or partially exercised requirements are not verified, even if the GitHub workflow succeeded.",
};
mkdirSync("test-results/auth", { recursive: true });
writeFileSync("test-results/auth/auth-live-results.json", JSON.stringify({
  schemaVersion: 1,
  target: { hostname, revision },
  startedAt: automated.startedAt,
  completedAt: automated.completedAt,
  tester: "GitHub Actions",
  verification,
  results,
}, null, 2) + "\n");
