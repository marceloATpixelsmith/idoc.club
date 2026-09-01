import 'server-only';

import { requestCookies } from '@/lib/auth/request-cookies';

// Deliberately a separate module from remembered-device.ts (which stays next/headers-free and
// fully unit-testable on its own): this is only the cookie glue, mirroring the split already
// established by login-device-trust.ts for the ordinary-member "remember this browser" feature.
export const REMEMBERED_TOTP_DEVICE_COOKIE = '__Host-idoc-mfa-remember';

export async function readRememberedTotpDeviceToken(): Promise<string | undefined> {
  return (await requestCookies()).get(REMEMBERED_TOTP_DEVICE_COOKIE)?.value;
}

export async function setRememberedTotpDeviceCookie(token: string, expiresAtMs: number, days: number): Promise<void> {
  (await requestCookies()).set(REMEMBERED_TOTP_DEVICE_COOKIE, token, {
    expires: new Date(expiresAtMs),
    httpOnly: true,
    maxAge: days * 24 * 60 * 60,
    path: '/',
    sameSite: 'lax',
    secure: true,
  });
}

export async function clearRememberedTotpDeviceCookie(): Promise<void> {
  (await requestCookies()).set(REMEMBERED_TOTP_DEVICE_COOKIE, '', {
    expires: new Date(0), httpOnly: true, maxAge: 0, path: '/', sameSite: 'lax', secure: true,
  });
}
