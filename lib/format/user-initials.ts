export function userInitials(firstName: string | null | undefined, lastName: string | null | undefined, email: string): string {
  const first = firstName?.trim()[0] ?? '';
  const last = lastName?.trim()[0] ?? '';
  if (first || last) return (first + last).toUpperCase();
  return (email[0] ?? '').toUpperCase();
}
