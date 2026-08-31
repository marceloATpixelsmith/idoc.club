import { readFileSync } from "node:fs";

const matrix = readFileSync("docs/22-canonical-auth-evidence-matrix.md", "utf8");
const backlog = readFileSync("docs/23-auth-security-remediation-backlog.md", "utf8");
const expected = {
  "implemented-but-unverified": 28,
  missing: 0,
  "not-applicable": 7,
  partial: 17,
  verified: 103,
};

const counts = Object.fromEntries(Object.keys(expected).map((status) => [status, 0]));
for (const line of matrix.split("\n")) {
  if (!line.startsWith("| AUTH-")) continue;
  const id = line.split("|")[1].trim();
  if (id.startsWith("AUTH-BOT-001..009")) {
    counts.verified += 8;
    counts["implemented-but-unverified"] += 1;
    continue;
  }
  const multiplier = id.startsWith("AUTH-INVITE-001/002/003")
    ? 3
    : id.startsWith("AUTH-TENANT-001/002")
      ? 2
      : 1;
  const cells = line.split("|").map((cell) => cell.trim().replaceAll("`", ""));
  const status = Object.keys(expected).find((candidate) => cells.includes(candidate));
  if (!status) throw new Error(`No status for matrix row: ${id}`);
  counts[status] += multiplier;
}
for (const [status, count] of Object.entries(expected)) {
  if (counts[status] !== count) {
    throw new Error(`${status}: expected ${count}, found ${counts[status]}`);
  }
}
if (Object.values(counts).reduce((sum, count) => sum + count, 0) !== 155) {
  throw new Error("Canonical matrix does not expand to 155 controls");
}
const backlogIds = backlog
  .split("\n")
  .filter((line) => line.startsWith("| AUTH-"))
  .map((line) => line.split("|")[1].trim());
if (backlogIds.length !== 45 || new Set(backlogIds).size !== 45) {
  throw new Error("Backlog must contain 45 unique applicable non-verified controls");
}
console.log("Auth documentation counts valid: 155 controls; 45 unique backlog rows.");
