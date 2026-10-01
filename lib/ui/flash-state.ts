import 'server-only';

import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

export const UI_FLASH_COOKIE_NAME = 'idoc_ui_flash';

export type UiFlashCode =
  | 'seminar-checkout-success'
  | 'seminar-checkout-canceled'
  | 'google-auth-failed'
  | 'google-link-required'
  | 'google-linked'
  | 'google-link-collision'
  | 'google-different-identity-linked'
  | 'google-verification-required'
  | 'google-unlink-failed'
  | 'password-created'
  | 'password-changed'
  | 'password-reset-success'
  | 'membership-canceled'
  | 'membership-checkout-success'
  | 'membership-renew-panel'
  | 'membership-renewal-setup-success'
  | 'profile-confirm-details';

type UiFlashPayload = {
  code: UiFlashCode;
  expiresAt: number;
  targetPath: string;
};

const MAX_AGE_SECONDS = 5 * 60;

function encodeFlash(payload: UiFlashPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeFlash(value: string | undefined): UiFlashPayload | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<UiFlashPayload>;
    if (typeof parsed.code !== 'string' || typeof parsed.targetPath !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    if (parsed.expiresAt <= Date.now()) return null;
    return parsed as UiFlashPayload;
  } catch {
    return null;
  }
}

function cookieOptions(maxAge = MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    maxAge,
    path: '/',
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
  };
}

export async function readUiFlash(targetPath: string): Promise<UiFlashCode | null> {
  const store = await cookies();
  const flash = decodeFlash(store.get(UI_FLASH_COOKIE_NAME)?.value);
  return flash?.targetPath === targetPath ? flash.code : null;
}

export async function setUiFlash(code: UiFlashCode, targetPath: string): Promise<void> {
  const store = await cookies();
  store.set(UI_FLASH_COOKIE_NAME, encodeFlash({
    code,
    expiresAt: Date.now() + MAX_AGE_SECONDS * 1000,
    targetPath,
  }), cookieOptions());
}

export function setUiFlashOnResponse(response: NextResponse, code: UiFlashCode, targetPath: string): NextResponse {
  response.cookies.set(UI_FLASH_COOKIE_NAME, encodeFlash({
    code,
    expiresAt: Date.now() + MAX_AGE_SECONDS * 1000,
    targetPath,
  }), cookieOptions());
  return response;
}

export async function clearUiFlash(targetPath?: string): Promise<void> {
  const store = await cookies();
  if (targetPath) {
    const flash = decodeFlash(store.get(UI_FLASH_COOKIE_NAME)?.value);
    if (!flash || flash.targetPath !== targetPath) return;
  }
  store.set(UI_FLASH_COOKIE_NAME, '', cookieOptions(0));
}
