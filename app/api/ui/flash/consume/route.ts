import { NextRequest, NextResponse } from 'next/server';
import { clearUiFlash } from '@/lib/ui/flash-state';

export async function POST(request: NextRequest) {
  let targetPath: string | undefined;
  try {
    const body = await request.json() as { targetPath?: unknown };
    targetPath = typeof body.targetPath === 'string' && body.targetPath.startsWith('/') ? body.targetPath : undefined;
  } catch {
    targetPath = undefined;
  }
  await clearUiFlash(targetPath);
  return NextResponse.json({ cleared: true });
}
