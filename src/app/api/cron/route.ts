import { NextResponse } from 'next/server';
import { tick, getDashboardData } from '@/lib/simulator';

export async function GET(request: Request) {
  // Verify authorization for cloud cron calls
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // In development, allow without auth. In production, require CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await tick();
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 200 });
    }
    return NextResponse.json({ success: true, timestamp: result.timestamp, price: result.currentPrice });
  } catch (error: any) {
    console.error('Cron tick error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
