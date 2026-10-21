import { readCsrfTokenFromDocumentCookie } from '@/lib/security/csrf-client';

/** Opens the member directory filtered to one National Federation. The filter is saved as the
 * member's directory view (the same saved-view route the table uses), never put in the URL, so it
 * replaces whatever search/filters they had before. Resolves false when the view could not be saved,
 * in which case the caller must not navigate. Signed-in members only: the route enforces it. */
export async function openDirectoryForCountry(countryCode: string, navigate: (href: string) => void): Promise<boolean> {
  try {
    const response = await fetch('/api/directory/view', {
      body: JSON.stringify({ federation: countryCode, page: 1, pageSize: 25 }),
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-idoc-csrf': readCsrfTokenFromDocumentCookie() },
      method: 'PUT',
    });
    if (!response.ok) return false;
    navigate('/about/members-directory?tab=directory');
    return true;
  } catch {
    return false;
  }
}
