import { GoogleOauthRotationForm } from '@/app/(dashboard)/admin/security/google-oauth-rotation-form';
import { explicitGoogleOauthClientSecretVersions } from '@/lib/auth/google-oidc-reference';
import { latestGoogleOauthSecretRotation } from '@/lib/auth/google-oidc-secret-audit';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireSuperAdmin } from '@/lib/membership/authorization';

export default async function AdminSecurityPage() {
  const actor = await requireAccountAccess('administration');
  requireSuperAdmin(actor);
  const { activeVersion } = explicitGoogleOauthClientSecretVersions();
  const latest = await latestGoogleOauthSecretRotation();
  return (
    <main className="flex-1 p-8">
      <h1 className="text-2xl font-semibold">Super Admin security operations</h1>
      <section className="mt-6">
        <h2 className="text-lg font-semibold">Google OAuth client-secret rotation</h2>
        {latest ? (
          <p className="mt-2 text-sm text-gray-600">
            Latest evidence: version <strong>{latest.toVersion}</strong>, recorded{' '}
            {new Date(latest.createdAtMs).toISOString()}.
          </p>
        ) : (
          <p className="mt-2 text-sm text-gray-600">No rotation evidence has been recorded yet.</p>
        )}
        <GoogleOauthRotationForm activeVersion={activeVersion} />
      </section>
    </main>
  );
}
