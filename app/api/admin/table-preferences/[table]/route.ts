import { NextResponse } from 'next/server';
import { rawCanonicalSessionId, rawCanonicalUserId } from '@/lib/auth/session';
import { resetTablePreferences, saveTablePreferences } from '@/lib/admin/table-preferences';
import { requireCsrfTokenValue } from '@/lib/security/csrf';

async function csrf(request: Request) {
  await requireCsrfTokenValue(request.headers.get('x-idoc-csrf'), await rawCanonicalSessionId(), await rawCanonicalUserId());
}

export async function PUT(request: Request, context: { params: Promise<{ table: string }> }) {
  try {
    await csrf(request);
    const { table } = await context.params;
    return NextResponse.json({ preferences: await saveTablePreferences(table, await request.json()) });
  } catch (error) {
    const status = error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError') ? 400 : error instanceof Error && error.name === 'AuthorizationError' ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? 'Table preferences could not be saved.' : 'Invalid table preferences.' }, { status });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ table: string }> }) {
  try {
    await csrf(request);
    const { table } = await context.params;
    await resetTablePreferences(table);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const status = error instanceof Error && error.name === 'AuthorizationError' ? 403 : 400;
    return NextResponse.json({ error: 'Table preferences could not be reset.' }, { status });
  }
}
