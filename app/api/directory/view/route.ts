import { NextResponse } from 'next/server';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import {
  DIRECTORY_VIEW_COOKIE, directoryViewCookieOptions, serializeDirectoryView,
} from '@/lib/directory/member-directory-view';
import { requireAccountAccess } from '@/lib/membership/data-access';
import { requireCsrfTokenValue } from '@/lib/security/csrf';

async function authorize(request: Request) {
  await requireCsrfTokenValue(request.headers.get('x-idoc-csrf'), await rawCanonicalSessionId(), await rawCanonicalUserId());
  await requireAccountAccess('member');
}

function failure(error: unknown) {
  const status = error instanceof SyntaxError ? 400 : error instanceof Error && error.name === 'AuthorizationError' ? 403 : 500;
  return NextResponse.json({ error: 'Directory view could not be saved.' }, { status });
}

export async function PUT(request: Request) {
  try {
    await authorize(request);
    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(DIRECTORY_VIEW_COOKIE, serializeDirectoryView(await request.json()), directoryViewCookieOptions());
    return response;
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await authorize(request);
    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(DIRECTORY_VIEW_COOKIE, '', { ...directoryViewCookieOptions(), maxAge: 0 });
    return response;
  } catch (error) {
    return failure(error);
  }
}
