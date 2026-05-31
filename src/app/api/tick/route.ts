import { NextResponse } from 'next/server';
import { tick, getDashboardData } from '@/lib/simulator';

export async function POST() {
  try {
    const result = await tick();
    if (!result.success) {
      // Even on tick failure, return current dashboard data
      const data = getDashboardData();
      return NextResponse.json({ ...data, tickError: result.error });
    }
    const data = getDashboardData();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Tick error:', error);
    try {
      // Try to return dashboard data even on error
      const data = getDashboardData();
      return NextResponse.json({ ...data, tickError: error.message });
    } catch {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
}
