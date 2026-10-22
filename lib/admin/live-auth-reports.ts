import 'server-only';
import { inflateRawSync } from 'node:zlib';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireSuperAdmin } from '@/lib/membership/authorization';

const API = 'https://api.github.com/repos/marceloATpixelsmith/idoc.club';
const headers = () => ({ Authorization: `Bearer ${process.env.GITHUB_BACKUP_TOOL_TOKEN ?? ''}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });

async function get(path: string) {
  if (!process.env.GITHUB_BACKUP_TOOL_TOKEN) throw new Error('GitHub access is not configured.');
  const response = await fetch(`${API}${path}`, { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}).`);
  return response;
}

export async function authorizeLiveAuthReport() {
  requireSuperAdmin(await requireAccountAccess('administration'));
}

type ReportResult = { id: string; status: string; summary: string; evidence: unknown[] };
export type LiveAuthReport = { target: { hostname: string; revision: string }; startedAt: string; completedAt: string; results: ReportResult[] };

function readReportZip(buffer: Buffer): LiveAuthReport {
  // Read the ZIP central directory rather than trusting local headers (artifacts use data descriptors).
  // Limit both archive and extracted JSON sizes to protect production memory.
  if (buffer.length > 35_000_000) throw new Error('Test artifact exceeds the report size limit.');
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new Error('Malformed test artifact ZIP.');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < count && i < 500; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP directory.');
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const uncompressed = buffer.readUInt32LE(offset + 24);
    const nameSize = buffer.readUInt16LE(offset + 28);
    const extraSize = buffer.readUInt16LE(offset + 30);
    const commentSize = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const filename = buffer.toString('utf8', offset + 46, offset + 46 + nameSize);
    offset += 46 + nameSize + extraSize + commentSize;
    if (filename !== 'test-results/auth/auth-live-results.json' && filename !== 'auth/auth-live-results.json' && filename !== 'auth-live-results.json') continue;
    if (uncompressed > 2_000_000 || compressed > 2_000_000 || localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid or oversized results JSON.');
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    if (start + compressed > buffer.length) throw new Error('Truncated results JSON.');
    const bytes = buffer.subarray(start, start + compressed);
    const extracted = method === 0 ? bytes : method === 8 ? inflateRawSync(bytes, { maxOutputLength: 2_000_000 }) : null;
    if (!extracted || extracted.length !== uncompressed) throw new Error('Unsupported results ZIP entry.');
    const payload: unknown = JSON.parse(extracted.toString('utf8'));
    if (!payload || typeof payload !== 'object' || !('results' in payload) || !Array.isArray(payload.results)) throw new Error('Invalid live authentication report.');
    return payload as LiveAuthReport;
  }
  throw new Error('This workflow has no live authentication results JSON in its artifact.');
}

export async function loadLiveAuthReport(runId: number): Promise<LiveAuthReport> {
  await authorizeLiveAuthReport();
  if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error('Invalid run.');
  const run = await (await get(`/actions/runs/${runId}`)).json() as { path?: string; head_sha?: string; name?: string };
  if (run.name !== 'Live authentication staging suite' || !run.path?.includes('live-auth-staging.yml')) throw new Error('That run is not a live authentication staging run.');
  const listing = await (await get(`/actions/runs/${runId}/artifacts?per_page=100`)).json() as { artifacts?: { id: number; name: string; expired: boolean }[] };
  const artifact = listing.artifacts?.find(item => item.name === 'live-auth-staging-results' && !item.expired);
  if (!artifact) throw new Error('Results artifact is missing or expired. Open the GitHub run for available logs.');
  const download = await get(`/actions/artifacts/${artifact.id}/zip`);
  const buffer = Buffer.from(await download.arrayBuffer());
  const report = readReportZip(buffer);
  if (report.target?.revision !== run.head_sha) throw new Error('Report revision does not match its GitHub run.');
  return report;
}
