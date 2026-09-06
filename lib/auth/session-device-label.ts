/** Derives a short, human-readable device/browser label (e.g. "Chrome on macOS") from a raw
 * User-Agent string, for display only on the account owner's own "Active sessions" list -- so they
 * can actually tell which entry is their phone versus an intruder's laptop, not just a timestamp.
 * Deliberately heuristic and approximate (User-Agent parsing always is); deliberately never persists
 * or returns the raw string itself, only this short derived label, matching this codebase's general
 * preference for storing the minimum derived signal rather than raw request data. */

const MAX_LABEL_LENGTH = 100;

function detectOs(userAgent: string): string | null {
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (/iPad/.test(userAgent)) return 'iPad';
  if (/Android/.test(userAgent)) return 'Android';
  if (/CrOS/.test(userAgent)) return 'ChromeOS';
  if (/Mac OS X/.test(userAgent)) return 'macOS';
  if (/Windows NT/.test(userAgent)) return 'Windows';
  if (/Linux/.test(userAgent)) return 'Linux';
  return null;
}

function detectBrowser(userAgent: string): string | null {
  // Order matters: several browsers' UA strings also contain "Safari/..." or "Chrome/..." tokens
  // for compatibility, so the more specific/identifying token must be checked first. Edge's mobile
  // builds use their own tokens (EdgA/ on Android, EdgiOS/ on iOS) rather than plain Edg/, but would
  // otherwise fall through to the Chrome/Safari checks below and be mislabeled.
  if (/Edg(?:A|iOS)?\//.test(userAgent)) return 'Edge';
  if (/OPR\//.test(userAgent)) return 'Opera';
  if (/SamsungBrowser\//.test(userAgent)) return 'Samsung Internet';
  if (/Firefox\//.test(userAgent) || /FxiOS\//.test(userAgent)) return 'Firefox';
  if (/CriOS\//.test(userAgent) || /Chrome\//.test(userAgent)) return 'Chrome';
  if (/Safari\//.test(userAgent)) return 'Safari';
  return null;
}

export function describeUserAgent(userAgent: string | null): string | null {
  if (!userAgent || !userAgent.trim()) return null;
  const browser = detectBrowser(userAgent);
  const os = detectOs(userAgent);
  const label = browser && os ? `${browser} on ${os}` : browser || os;
  if (!label) return null;
  return label.length > MAX_LABEL_LENGTH ? label.slice(0, MAX_LABEL_LENGTH) : label;
}
