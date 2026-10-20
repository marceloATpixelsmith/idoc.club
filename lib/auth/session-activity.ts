/** The registry row's last_activity_at only feeds the Active sessions list's idle filter (the cookie's own idle timer is what ends a
 * session), so it needs minute resolution, not per-request resolution. Callers that already hold the row skip the write while it is
 * fresher than this, which removes an UPDATE round trip from nearly every request in a burst. */
export const SESSION_ACTIVITY_TOUCH_INTERVAL_MS = 60_000;

/** True when the registry row should be touched. Unknown, unparseable or older-than-the-interval activity touches; clock skew into the
 * future never forces a write. */
export function sessionActivityNeedsTouch(lastActivityAt: string | Date | null | undefined, now: Date): boolean {
  if (!lastActivityAt) return true;
  const last = new Date(lastActivityAt).getTime();
  return !Number.isFinite(last) || now.getTime() - last >= SESSION_ACTIVITY_TOUCH_INTERVAL_MS;
}
