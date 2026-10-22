import { NextRequest, NextResponse } from 'next/server';
import { loadLiveAuthReport } from '@/lib/admin/live-auth-reports';

export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  if (!/^\d+$/.test(runId)) return NextResponse.json({ error: 'Invalid run.' }, { status: 400 });
  try {
    const report = await loadLiveAuthReport(Number(runId));
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && (error.name === 'AuthorizationError' || error.message.includes('authorized'))) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : 'Could not load the test report.';
    return NextResponse.json({ error: message }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
