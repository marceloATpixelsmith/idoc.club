import { googleOauthClientSecretVersions } from '../lib/auth/google-oidc-reference.ts';
import { recordGoogleOauthSecretRotation, latestGoogleOauthSecretRotation } from '../lib/auth/google-oidc-secret-audit.ts';

// AUTH-SECRET-004: operator tooling for the runbook step that follows flipping
// GOOGLE_OAUTH_CLIENT_SECRET_ACTIVE_VERSION in the deployed environment (docs/07 §15.1). Records a
// secret-free audit trail entry -- only the version *labels*, never the secret values -- of when the
// active version last changed and why. Run after redeploying with the new active version already
// live, so the current process's own configuration is what gets validated against.
//
// Usage: node --conditions=react-server --import tsx scripts/rotate-google-oauth-secret.ts \
//   --to-version=v2 --reason=scheduled_rotation [--from-version=v1] [--actor-id=42]

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const toVersion = arg('to-version');
  const reason = arg('reason');
  const fromVersionArg = arg('from-version');
  const actorIdArg = arg('actor-id');

  if (!toVersion) throw new Error('Usage: --to-version=<version> is required.');
  if (reason !== 'scheduled_rotation' && reason !== 'rollback' && reason !== 'compromise_response') {
    throw new Error('Usage: --reason must be one of scheduled_rotation, rollback, compromise_response.');
  }

  const versions = googleOauthClientSecretVersions();
  if (!versions.has(toVersion)) {
    throw new Error(`--to-version "${toVersion}" is not present in this process's current GOOGLE_OAUTH_CLIENT_SECRET_VERSIONS ring. Deploy with the new version already configured before recording its rotation.`);
  }

  let fromVersion: string | null;
  if (fromVersionArg !== undefined) {
    if (!versions.has(fromVersionArg)) {
      throw new Error(`--from-version "${fromVersionArg}" is not present in this process's current ring. Retired versions should still be listed until this rotation is recorded.`);
    }
    fromVersion = fromVersionArg;
  } else {
    fromVersion = (await latestGoogleOauthSecretRotation())?.toVersion ?? null;
  }

  const actorId = actorIdArg === undefined ? null : Number(actorIdArg);
  if (actorIdArg !== undefined && (!Number.isSafeInteger(actorId) || actorId! < 1)) {
    throw new Error('--actor-id must be a positive integer user id.');
  }

  await recordGoogleOauthSecretRotation({ actorId, fromVersion, reason, toVersion });
  console.log(`Recorded Google OAuth client secret rotation: ${fromVersion ?? '(none)'} -> ${toVersion} (${reason}).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
