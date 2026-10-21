import { mkdirSync, writeFileSync } from "node:fs";

export default class LiveAuthReporter {
  constructor() {
    this.results = [];
    this.startedAt = new Date().toISOString();
  }

  onTestEnd(test, result) {
    const annotation = test.annotations.find((item) => item.type === "live-auth-cases" || item.type === "live-auth-partial-cases");
    if (!annotation) return;
    const ids = String(annotation.description || "").split(",").filter((id) => /^LIVE-AUTH-\d{3}$/.test(id));
    for (const id of ids) {
      this.results.push({
        id,
        status: result.status === "passed" && annotation.type === "live-auth-cases" ? "pass" : result.status === "passed" ? "partial" : "fail",
        summary: result.status === "passed" && annotation.type === "live-auth-cases" ? "Live browser journey passed." : result.status === "passed" ? "Partial live evidence only; full matrix criteria were not exercised." : "Live browser journey failed.",
        evidence: [test.title],
      });
    }
  }

  onEnd() {
    mkdirSync("test-results/auth", { recursive: true });
    writeFileSync("test-results/auth/live-automated-case-results.json", JSON.stringify({
      startedAt: this.startedAt,
      completedAt: new Date().toISOString(),
      results: this.results,
    }, null, 2) + "\n");
  }
}
