// TEMPORARY: intentionally fails `next build` (prerender) to verify New Relic
// failed-deployment tracking on staging. Revert immediately after verification.
export const dynamic = 'force-static';

export default function NrDeployFailureTestPage() {
  throw new Error('Intentional build failure for New Relic failed-deployment verification');
}
