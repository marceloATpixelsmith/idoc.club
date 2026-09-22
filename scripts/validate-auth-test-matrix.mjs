import { existsSync, readFileSync } from "node:fs";

const path = "tests/auth/auth-test-matrix.json";
const manifest = JSON.parse(readFileSync(path, "utf8"));

if (manifest.schemaVersion !== 1) throw new Error("Unsupported auth test matrix schemaVersion.");
if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) throw new Error("Auth test matrix has no cases.");

const ids = new Set();
const allowedRisk = new Set(["low", "medium", "high", "critical"]);
const allowedCoverage = new Set(["mapped", "gap", "na"]);

for (let index = 0; index < manifest.cases.length; index += 1) {
  const c = manifest.cases[index];
  const expectedId = "LIVE-AUTH-" + String(index + 1).padStart(3, "0");
  if (c.id !== expectedId) throw new Error("Expected " + expectedId + " at position " + (index + 1) + "; found " + c.id);
  if (ids.has(c.id)) throw new Error("Duplicate auth test ID: " + c.id);
  ids.add(c.id);
  if (!allowedRisk.has(c.risk)) throw new Error(c.id + ": invalid risk " + c.risk);
  if (!["applicable", "not-applicable"].includes(c.applicability)) throw new Error(c.id + ": invalid applicability");
  if (!allowedCoverage.has(c.ci.coverage)) throw new Error(c.id + ": invalid CI coverage " + c.ci.coverage);
  if (!Array.isArray(c.canonicalControls) || !c.canonicalControls.every((x) => /^AUTH-[A-Z]+-\d{3}$/.test(x))) {
    throw new Error(c.id + ": canonicalControls must contain canonical AUTH-* IDs");
  }
  if (c.ci.coverage === "mapped") {
    if (!Array.isArray(c.ci.tests) || c.ci.tests.length === 0) throw new Error(c.id + ": mapped CI coverage requires tests");
    for (const testPath of c.ci.tests) {
      if (!existsSync(testPath)) throw new Error(c.id + ": mapped CI test does not exist: " + testPath);
    }
  }
  if (c.ci.coverage === "gap" && (!c.ci.rationale || c.ci.rationale.trim().length < 20)) {
    throw new Error(c.id + ": CI gap requires a specific rationale");
  }
  if (c.ci.coverage === "na" && c.applicability !== "not-applicable") {
    throw new Error(c.id + ": CI coverage na requires not-applicable case");
  }
  if (c.applicability === "applicable" && !c.live.enabled) throw new Error(c.id + ": applicable case must remain live-enabled");
  if (c.live.enabled) {
    for (const key of ["preconditions", "steps", "pass", "fail", "cleanup", "evidence"]) {
      if (!Array.isArray(c.live[key])) throw new Error(c.id + ": live." + key + " must be an array");
    }
    if (!c.live.steps.length || !c.live.pass.length || !c.live.fail.length) {
      throw new Error(c.id + ": live-enabled cases require steps, pass, and fail criteria");
    }
  }
}

console.log("Auth test matrix valid: " + manifest.cases.length + " synchronized CI/live cases.");
