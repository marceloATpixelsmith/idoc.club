// PROMOTION MUST FAIL CLOSED; NEVER SKIP REVIEWS, CHECKS OR BRANCH-PROTECTION GATES.
import { appendFileSync } from 'node:fs';

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
const prNumber = Number(process.env.PROMOTION_PR_NUMBER);
const expectedHead = process.env.PROMOTION_EXPECTED_HEAD_SHA;
const phase = process.argv[2];
const deadline = Date.now() + 45 * 60 * 1000;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

if (!repository || !token || !['verify', 'merge', 'deploy', 'health'].includes(phase)) {
  throw new Error('Required promotion runtime context is missing.');
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function api(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`GitHub request failed: ${path.split('?')[0]} returned ${response.status}.`);
  }
  return response.status === 204 ? null : response.json();
}

async function graphql(query, variables) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`GitHub review-thread query returned ${response.status}.`);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error('GitHub review-thread query failed.');
  return payload.data;
}

function assertRequest() {
  if (!Number.isSafeInteger(prNumber) || prNumber < 1 || !/^[a-f0-9]{40}$/i.test(expectedHead ?? '')) {
    throw new Error('Expected exact promotion PR number and staging commit SHA.');
  }
}

async function promotionPullRequest() {
  const pr = await api(`/pulls/${prNumber}`);
  if (pr.base?.ref !== 'main' || pr.head?.ref !== 'staging' ||
    pr.head?.repo?.full_name !== repository || pr.head?.sha !== expectedHead ||
    pr.draft || pr.state !== 'open') {
    throw new Error('Promotion PR is closed, changed, draft, or does not match the authorized staging commit.');
  }
  const staging = await api('/branches/staging');
  if (staging.commit.sha !== expectedHead) {
    throw new Error('Staging has changed since promotion was authorized. Start a fresh promotion.');
  }
  if (pr.labels?.some((label) => label.name === 'hold-merge')) {
    throw new Error('Promotion PR has a hold-merge label.');
  }
  // The repository also permits explicit holds in ordinary PR comments.
  // Only the repository owner can clear a hold recorded there.
  const comments = await api(`/issues/${prNumber}/comments?per_page=100`);
  if (comments.length === 100) {
    throw new Error('Promotion PR comment history is too long to verify safely.');
  }
  let activeHold = false;
  const repositoryOwner = repository.split('/')[0].toLowerCase();
  for (const comment of comments) {
    const text = comment.body ?? '';
    if (/(?:^|\s)(?:hold-merge|do not merge|hold promotion)(?:\s|$|[.,!:])/im.test(text)) {
      activeHold = true;
    }
    if (/(?:^|\s)clear-hold-merge(?:\s|$|[.,!:])/im.test(text) &&
      comment.user?.login?.toLowerCase() === repositoryOwner) {
      activeHold = false;
    }
  }
  if (activeHold) {
    throw new Error('Promotion PR has an active hold recorded in comments.');
  }
  return pr;
}

async function reviewState() {
  const reviews = await api(`/pulls/${prNumber}/reviews?per_page=100`);
  if (reviews.length === 100) throw new Error('Review list exceeded the safe single-page limit.');
  const latest = new Map();
  for (const review of reviews) {
    if (review.state !== 'PENDING') latest.set(review.user?.login, review.state);
  }
  if ([...latest.values()].includes('CHANGES_REQUESTED')) {
    throw new Error('Promotion PR has outstanding change requests.');
  }
  const [owner, name] = repository.split('/');
  const data = await graphql(
    `query($owner:String!,$name:String!,$number:Int!){
      repository(owner:$owner,name:$name){
        pullRequest(number:$number){
          reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved}}
        }
      }
    }`,
    { owner, name, number: prNumber },
  );
  const threads = data?.repository?.pullRequest?.reviewThreads;
  if (!threads || threads.pageInfo.hasNextPage || threads.nodes.some((thread) => !thread.isResolved)) {
    throw new Error('Promotion PR has unresolved or unverified review threads.');
  }
}

async function checkCi() {
  // Promotion can affect production runtime, database and authorization; require
  // ALL three risk-classified workflows on the exact current staging SHA.
  // Include explicitly dispatched runs as well as ordinary PR-triggered runs.
  const result = await api(`/actions/runs?head_sha=${expectedHead}&per_page=100`);
  if (!Array.isArray(result.workflow_runs) || result.total_count >= 100) {
    throw new Error('Unable to enumerate every required promotion workflow run safely.');
  }
  const names = [
    'Fast PR verification',
    'Release 1 Verification',
    'Authentication security verification',
  ];
  for (const name of names) {
    const candidates = result.workflow_runs.filter((run) =>
      run.name === name &&
      run.head_sha === expectedHead &&
      (run.event === 'workflow_dispatch' ||
        (run.event === 'pull_request' && run.pull_requests?.some((pr) => pr.number === prNumber))));
    const latest = candidates.sort((a, b) =>
      Date.parse(b.created_at) - Date.parse(a.created_at))[0];
    if (!latest) {
      console.log(`Required workflow ${name} has no run for the current staging commit.`);
      return false;
    }
    if (latest.status !== 'completed') return false;
    if (latest.conclusion !== 'success') {
      throw new Error(`Required workflow ${name} did not succeed: ${latest.conclusion ?? 'unknown'}.`);
    }
  }
  return true;
}

async function verify({ wait }) {
  assertRequest();
  do {
    const pr = await promotionPullRequest();
    await reviewState();
    const ready = await checkCi();
    if (ready && pr.mergeable === true && ['clean', 'has_hooks'].includes(pr.mergeable_state)) {
      console.log(`All visible gates passed for PR #${prNumber}, commit ${expectedHead}.`);
      return;
    }
    if (!wait) throw new Error('Promotion gates are no longer satisfied. No merge performed.');
    if (pr.mergeable === false || ['dirty', 'behind'].includes(pr.mergeable_state)) {
      throw new Error('Promotion PR has conflicts or an outdated branch.');
    }
    console.log('Waiting for required PR checks and mergeability...');
    await sleep(15000);
  } while (Date.now() < deadline);
  throw new Error('Timed out awaiting promotion checks and review readiness.');
}

async function merge() {
  await verify({ wait: false });
  const result = await api(`/pulls/${prNumber}/merge`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ merge_method: 'merge', sha: expectedHead }),
  });
  if (!result.merged || !/^[a-f0-9]{40}$/i.test(result.sha ?? '')) {
    throw new Error('GitHub did not confirm the promotion merge.');
  }
  const main = await api('/branches/main');
  if (main.commit.sha !== result.sha) {
    throw new Error('Main branch does not point to the recorded promotion merge.');
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `merge_sha=${result.sha}\n`);
  console.log(`Promotion PR merged at ${result.sha}.`);
}

function mergeSha() {
  const sha = process.env.PROMOTION_MERGE_SHA;
  if (!/^[a-f0-9]{40}$/i.test(sha ?? '')) throw new Error('Verified merge SHA missing.');
  return sha;
}

async function deploy() {
  const sha = mergeSha();
  while (Date.now() < deadline) {
    const main = await api('/branches/main');
    if (main.commit.sha !== sha) throw new Error('Main advanced after promotion merge; deployment identity ambiguous.');
    const statuses = await api(`/commits/${sha}/statuses?per_page=100`);
    if (statuses.length === 100) throw new Error('Commit statuses exceeded safe page limit.');
    const vercel = statuses.find((item) => item.context === 'Vercel');
    if (vercel?.state === 'success') {
      if (!vercel.target_url?.startsWith('https://vercel.com/ayni-team/idoc.club/')) {
        throw new Error('Vercel success status does not belong to the expected project.');
      }
      console.log(`Vercel confirmed deployment of merge commit ${sha}: ${vercel.target_url}`);
      return;
    }
    if (vercel && ['failure', 'error'].includes(vercel.state)) {
      throw new Error(`Vercel reported ${vercel.state} for merge commit ${sha}.`);
    }
    console.log('Waiting for Vercel production deployment status...');
    await sleep(15000);
  }
  throw new Error('Vercel did not confirm deployment of the production merge commit before timeout.');
}

async function health() {
  const sha = mergeSha();
  const url = process.env.PRODUCTION_HEALTH_URL;
  if (!url || !/^https:\/\/(redesign\.)?idoc\.club\/api\/health$/.test(url)) {
    throw new Error('Configure PRODUCTION_HEALTH_URL as the active production /api/health URL in GitHub Actions variables.');
  }
  const main = await api('/branches/main');
  if (main.commit.sha !== sha) throw new Error('Main changed before health verification.');
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Production health endpoint failed (HTTP ${response.status}).`);
  console.log(`Production health endpoint returned HTTP ${response.status}; merge ${sha} was deployed.`);
}

if (phase === 'verify') await verify({ wait: true });
if (phase === 'merge') await merge();
if (phase === 'deploy') await deploy();
if (phase === 'health') await health();
