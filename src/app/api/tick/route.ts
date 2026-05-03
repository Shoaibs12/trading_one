import { NextResponse } from 'next/server';
import { tick, getDashboardData } from '@/lib/simulator';

export async function POST() {
  try {
    await tick();
    const data = getDashboardData();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
