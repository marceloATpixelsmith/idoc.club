import { createHmac, timingSafeEqual } from 'node:crypto';

// Identifying action links (docs/05, docs/07). An action button in a member email points at
// `<origin>/l/<slot>~<source><id>~<signature>` instead of straight at the page. The server verifies the signature,
// looks up who the email was sent to, records the click against that member, then redirects to the real page, so
// a click is tied to a member even when they are not signed in. The reference only identifies the recipient; it grants
// no access, and the destination comes from the fixed table below, never from the link.

export const EMAIL_LINK_SLOTS = {
  howto: '/dashboard/how-to-use',
  membership: '/dashboard/membership',
} as const;
export type EmailLinkSlot = keyof typeof EMAIL_LINK_SLOTS;

/** Which outbox table the numeric id belongs to. */
export const EMAIL_LINK_SOURCES = { auth_security: 's', notification: 'n' } as const;
export type EmailLinkSource = keyof typeof EMAIL_LINK_SOURCES;

export type EmailLinkReference = { id: number; slot: EmailLinkSlot; source: EmailLinkSource };

const SIGNATURE_LENGTH = 22; // 16 bytes of HMAC-SHA256 in base64url

/** Derived from AUTH_SECRET so no new secret has to be provisioned; null where it is not configured (previews, tests). */
export function emailLinkKey(environment: Record<string, string | undefined> = process.env): Buffer | null {
  const secret = environment.AUTH_SECRET?.trim();
  if (!secret) return null;
  return createHmac('sha256', secret).update('idoc:email-link:v1').digest();
}

function sign(key: Buffer, body: string): string {
  return createHmac('sha256', key).update(body).digest('base64url').slice(0, SIGNATURE_LENGTH);
}

export function emailLinkReference(reference: EmailLinkReference, key: Buffer): string {
  const body = `${reference.slot}~${EMAIL_LINK_SOURCES[reference.source]}${reference.id}`;
  return `${body}~${sign(key, body)}`;
}

/** The verified reference, or null for anything malformed, forged or unknown. Constant-time signature comparison. */
export function parseEmailLinkReference(value: string, key: Buffer): EmailLinkReference | null {
  const parts = value.split('~');
  if (parts.length !== 3 || value.length > 80) return null;
  const [slot, sourceAndId, signature] = parts;
  if (!(slot in EMAIL_LINK_SLOTS)) return null;
  const sourceCode = sourceAndId[0];
  const source = (Object.keys(EMAIL_LINK_SOURCES) as EmailLinkSource[]).find((name) => EMAIL_LINK_SOURCES[name] === sourceCode);
  const id = Number(sourceAndId.slice(1));
  if (!source || !/^[1-9]\d{0,9}$/.test(sourceAndId.slice(1)) || !Number.isSafeInteger(id)) return null;
  const expected = Buffer.from(sign(key, `${slot}~${sourceAndId}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { id, slot: slot as EmailLinkSlot, source };
}

/** Where a notice's button goes: the identifying link when the message belongs to a stored notification and a key is
 * configured, otherwise the plain page URL (previews, tests, and isolated workers keep working unchanged). */
export function emailActionUrl(options: {
  environment?: Record<string, string | undefined>;
  notificationId?: number;
  slot: EmailLinkSlot;
  source?: EmailLinkSource;
}): string {
  const environment = options.environment ?? process.env;
  const origin = (environment.BASE_URL?.trim() || 'https://idoc.club').replace(/\/+$/, '');
  const key = emailLinkKey(environment);
  if (options.notificationId && key) {
    return `${origin}/l/${emailLinkReference({ id: options.notificationId, slot: options.slot, source: options.source ?? 'notification' }, key)}`;
  }
  return `${origin}${EMAIL_LINK_SLOTS[options.slot]}`;
}
