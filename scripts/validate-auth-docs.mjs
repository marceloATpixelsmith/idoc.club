import { readFileSync } from "node:fs";

const matrix = readFileSync("docs/22-canonical-auth-evidence-matrix.md", "utf8");
const backlog = readFileSync("docs/23-auth-security-remediation-backlog.md", "utf8");

const statuses = new Set([
  "verified",
  "implemented-but-unverified",
  "partial",
  "missing",
  "not-applicable",
]);
const remediationStatuses = new Set([
  "implemented-but-unverified",
  "partial",
  "missing",
]);

function expandCanonicalIds(label) {
  const clean = label.replaceAll("`", "").replace(/\s*\(.*/, "").trim();

  const range = clean.match(/^(AUTH-[A-Z]+-)(\d{3})\.\.(\d{3})$/);
  if (range) {
    const [, prefix, startRaw, endRaw] = range;
    const start = Number(startRaw);
    const end = Number(endRaw);
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
      throw new Error(`Invalid canonical ID range: ${label}`);
    }
    return Array.from({ length: end - start + 1 }, (_, index) =>
      `${prefix}${String(start + index).padStart(3, "0")}`,
    );
  }

  const grouped = clean.match(/^(AUTH-[A-Z]+-)(\d{3}(?:\/\d{3})+)$/);
  if (grouped) {
    const [, prefix, suffixes] = grouped;
    return suffixes.split("/").map((suffix) => `${prefix}${suffix}`);
  }

  if (/^AUTH-[A-Z]+-\d{3}$/.test(clean)) return [clean];
  throw new Error(`Unsupported canonical ID label: ${label}`);
}

function parseStatus(cells, label) {
  const explicit = cells.filter((cell) => statuses.has(cell.replaceAll("`", "")));
  if (explicit.length === 1) return explicit[0].replaceAll("`", "");
  if (explicit.length > 1) {
    throw new Error(`Ambiguous status for matrix row ${label}: ${explicit.join(", ")}`);
  }
  return null;
}

const matrixById = new Map();
for (const line of matrix.split("\n")) {
  if (!line.startsWith("| AUTH-")) continue;
  const cells = line.split("|").map((cell) => cell.trim());
  const label = cells[1];

  // The Turnstile row historically bundled mixed statuses. Keep support for a mixed row,
  // but require any exception to be explicit in the assessment text rather than inferred
  // from prose elsewhere in the row.
  if (label.startsWith("AUTH-BOT-001..009")) {
    const assessment = cells.find((cell) => cell.includes("verified") || cell.includes("implemented-but-unverified")) ?? "";
    const ids = expandCanonicalIds("AUTH-BOT-001..009");
    const unverifiedMatch = assessment.match(/implemented-but-unverified\s*\((\d{3})\)/);
    const unverifiedSuffix = unverifiedMatch?.[1] ?? null;
    for (const id of ids) {
      const status = unverifiedSuffix && id.endsWith(`-${unverifiedSuffix}`)
        ? "implemented-but-unverified"
        : "verified";
      if (matrixById.has(id)) throw new Error(`Duplicate matrix ID: ${id}`);
      matrixById.set(id, status);
    }
    continue;
  }

  const status = parseStatus(cells, label);
  if (!status) throw new Error(`No status for matrix row: ${label}`);
  for (const id of expandCanonicalIds(label)) {
    if (matrixById.has(id)) throw new Error(`Duplicate matrix ID: ${id}`);
    matrixById.set(id, status);
  }
}

if (matrixById.size !== 155) {
  throw new Error(`Canonical matrix must expand to 155 controls; found ${matrixById.size}`);
}

const counts = Object.fromEntries([...statuses].map((status) => [status, 0]));
for (const status of matrixById.values()) counts[status] += 1;
if (Object.values(counts).reduce((sum, count) => sum + count, 0) !== 155) {
  throw new Error("Canonical matrix status counts do not sum to 155 controls");
}

const backlogById = new Map();
for (const line of backlog.split("\n")) {
  if (!line.startsWith("| AUTH-")) continue;
  const cells = line.split("|").map((cell) => cell.trim().replaceAll("`", ""));
  const id = cells[1];
  if (!/^AUTH-[A-Z]+-\d{3}$/.test(id)) {
    throw new Error(`Backlog rows must contain one canonical ID each; found ${id}`);
  }
  const classification = cells[3];
  if (!statuses.has(classification)) {
    throw new Error(`Backlog row ${id} has unknown classification: ${classification}`);
  }
  if (backlogById.has(id)) throw new Error(`Duplicate backlog ID: ${id}`);
  backlogById.set(id, classification);
}

const expectedBacklog = new Map(
  [...matrixById].filter(([, status]) => remediationStatuses.has(status)),
);

const missing = [...expectedBacklog.keys()].filter((id) => !backlogById.has(id));
const extra = [...backlogById.keys()].filter((id) => !expectedBacklog.has(id));
const classificationMismatches = [...expectedBacklog]
  .filter(([id, status]) => backlogById.get(id) !== undefined && backlogById.get(id) !== status)
  .map(([id, status]) => `${id}: matrix=${status}, backlog=${backlogById.get(id)}`);

if (missing.length || extra.length || classificationMismatches.length) {
  const details = [
    missing.length ? `missing from backlog: ${missing.join(", ")}` : null,
    extra.length ? `extra in backlog: ${extra.join(", ")}` : null,
    classificationMismatches.length
      ? `classification mismatches: ${classificationMismatches.join("; ")}`
      : null,
  ].filter(Boolean);
  throw new Error(`Auth remediation backlog does not match the matrix: ${details.join(" | ")}`);
}

console.log(
  `Auth documentation valid: 155 controls; ${expectedBacklog.size} exact applicable non-verified backlog rows ` +
    `(${counts.verified} verified, ${counts["implemented-but-unverified"]} implemented-but-unverified, ` +
    `${counts.partial} partial, ${counts.missing} missing, ${counts["not-applicable"]} not-applicable).`,
);
