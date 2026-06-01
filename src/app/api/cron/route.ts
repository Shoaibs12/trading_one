import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { tick, getDashboardData } from '@/lib/simulator';

export async function GET() {
  // Verify authorization for cloud cron calls
  const headersList = await headers();
  const authHeader = headersList.get('authorization');
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
