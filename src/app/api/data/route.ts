import { NextResponse } from 'next/server';
import { getDashboardData } from '@/lib/simulator';

export async function GET() {
  try {
    const data = getDashboardData();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
