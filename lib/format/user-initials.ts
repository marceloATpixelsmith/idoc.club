export function userInitials(name: string | null | undefined, email: string): string {
  const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length > 0) {
    const first = words[0][0];
    const last = words.length > 1 ? words[words.length - 1][0] : '';
    return (first + last).toUpperCase();
  }
  return (email[0] ?? '').toUpperCase();
}
