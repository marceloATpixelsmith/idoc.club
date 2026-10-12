const branch = process.env.VERCEL_GIT_COMMIT_REF;
const commitSha = process.env.VERCEL_GIT_COMMIT_SHA;

async function main()
{
  if (!["staging", "main"].includes(branch) || !/^[0-9a-f]{40}$/i.test(commitSha ?? ""))
  {
    return;
  }

  try
  {
    const response = await fetch(
      `https://api.github.com/repos/marceloATpixelsmith/idoc.club/commits/${commitSha}/pulls`,
      {
        headers:
        {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (!response.ok)
    {
      throw new Error(`GitHub returned HTTP ${response.status}`);
    }

    const pullRequests = await response.json();
    const isMergedIntoCurrentBranch = pullRequests.some(
      (pullRequest) =>
      {
        return Boolean(pullRequest.merged_at)
          && pullRequest.base?.ref === branch;
      },
    );

    if (isMergedIntoCurrentBranch)
    {
      process.exitCode = 1;
    }
  }
  catch (error)
  {
    console.error(
      "Ignored Build Step: GitHub merge verification failed; skipping deployment.",
      error,
    );
  }
}

await main();
